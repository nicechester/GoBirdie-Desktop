// garmin_mtp_windows.cpp — WPD-based Garmin watch file downloader for Windows
// Outputs JSON array of {scorecard, activity, ...} matching the macOS garmin_mtp format.
// Usage: garmin_mtp_windows <dest_dir> [count] [offset]
// Compile: cl /W3 /EHsc garmin_mtp_windows.cpp /link Propsys.lib PortableDeviceGuids.lib Ole32.lib

#include <windows.h>
#include <PortableDeviceApi.h>
#include <PortableDevice.h>
#include <propvarutil.h>
#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <algorithm>
#include <cstdlib>
#include <cmath>

#pragma comment(lib, "Ole32.lib")
#pragma comment(lib, "Propsys.lib")
#pragma comment(lib, "PortableDeviceGuids.lib")

#define MIN_GOLF_SIZE 50000

struct FileEntry {
    std::wstring objectId;
    std::wstring filename;
    ULONGLONG filesize;
    FILETIME mtime;
};

static long long FiletimeToUnix(const FILETIME& ft) {
    ULARGE_INTEGER ull;
    ull.LowPart = ft.dwLowDateTime;
    ull.HighPart = ft.dwHighDateTime;
    return (long long)(ull.QuadPart / 10000000ULL - 11644473600ULL);
}

static std::string WideToUtf8(const std::wstring& w) {
    if (w.empty()) return "";
    int sz = WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string s(sz - 1, '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.c_str(), -1, &s[0], sz, nullptr, nullptr);
    return s;
}

static std::wstring FindGarminDevice(IPortableDeviceManager* mgr) {
    DWORD count = 0;
    mgr->GetDevices(nullptr, &count);
    if (count == 0) return L"";

    std::vector<LPWSTR> ids(count);
    mgr->GetDevices(ids.data(), &count);

    for (DWORD i = 0; i < count; i++) {
        DWORD nameLen = 0;
        mgr->GetDeviceDescription(ids[i], nullptr, &nameLen);
        if (nameLen > 0) {
            std::wstring name(nameLen, L'\0');
            mgr->GetDeviceDescription(ids[i], &name[0], &nameLen);
            // Check for Garmin in device name
            std::wstring lower = name;
            for (auto& c : lower) c = towlower(c);
            if (lower.find(L"garmin") != std::wstring::npos) {
                std::wstring result = ids[i];
                for (DWORD j = 0; j < count; j++) CoTaskMemFree(ids[j]);
                return result;
            }
        }
    }

    // Fallback: return first device
    std::wstring result = ids[0];
    for (DWORD j = 0; j < count; j++) CoTaskMemFree(ids[j]);
    return result;
}

static IPortableDevice* OpenDevice(const std::wstring& deviceId) {
    IPortableDevice* device = nullptr;
    CoCreateInstance(CLSID_PortableDeviceFTM, nullptr, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&device));
    if (!device) return nullptr;

    IPortableDeviceValues* clientInfo = nullptr;
    CoCreateInstance(CLSID_PortableDeviceValues, nullptr, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&clientInfo));
    clientInfo->SetStringValue(WPD_CLIENT_NAME, L"GoBirdie");
    clientInfo->SetUnsignedIntegerValue(WPD_CLIENT_MAJOR_VERSION, 1);
    clientInfo->SetUnsignedIntegerValue(WPD_CLIENT_MINOR_VERSION, 0);
    clientInfo->SetUnsignedIntegerValue(WPD_CLIENT_REVISION, 0);

    HRESULT hr = device->Open(deviceId.c_str(), clientInfo);
    clientInfo->Release();
    if (FAILED(hr)) { device->Release(); return nullptr; }
    return device;
}

static std::wstring FindFolder(IPortableDeviceContent* content, const std::wstring& parentId,
                                const std::wstring& targetName) {
    IEnumPortableDeviceObjectIDs* enumObj = nullptr;
    content->EnumObjects(0, parentId.c_str(), nullptr, &enumObj);
    if (!enumObj) return L"";

    LPWSTR objIds[32];
    DWORD fetched = 0;
    while (enumObj->Next(32, objIds, &fetched) == S_OK && fetched > 0) {
        for (DWORD i = 0; i < fetched; i++) {
            IPortableDeviceProperties* props = nullptr;
            content->Properties(&props);
            IPortableDeviceValues* vals = nullptr;
            IPortableDeviceKeyCollection* keys = nullptr;
            CoCreateInstance(CLSID_PortableDeviceKeyCollection, nullptr, CLSCTX_INPROC_SERVER,
                             IID_PPV_ARGS(&keys));
            keys->Add(WPD_OBJECT_NAME);
            keys->Add(WPD_OBJECT_CONTENT_TYPE);
            props->GetValues(objIds[i], keys, &vals);
            keys->Release();
            props->Release();

            GUID contentType = GUID_NULL;
            vals->GetGuidValue(WPD_OBJECT_CONTENT_TYPE, &contentType);

            LPWSTR name = nullptr;
            vals->GetStringValue(WPD_OBJECT_NAME, &name);
            vals->Release();

            if (name && contentType == WPD_CONTENT_TYPE_FOLDER) {
                std::wstring n = name;
                if (_wcsicmp(n.c_str(), targetName.c_str()) == 0) {
                    std::wstring result = objIds[i];
                    CoTaskMemFree(name);
                    for (DWORD j = 0; j < fetched; j++) CoTaskMemFree(objIds[j]);
                    enumObj->Release();
                    return result;
                }
            }
            if (name) CoTaskMemFree(name);
            CoTaskMemFree(objIds[i]);
        }
        fetched = 0;
    }
    enumObj->Release();
    return L"";
}

static std::vector<FileEntry> ListFiles(IPortableDeviceContent* content, const std::wstring& folderId,
                                         ULONGLONG minSize = 0) {
    std::vector<FileEntry> files;
    IEnumPortableDeviceObjectIDs* enumObj = nullptr;
    content->EnumObjects(0, folderId.c_str(), nullptr, &enumObj);
    if (!enumObj) return files;

    LPWSTR objIds[64];
    DWORD fetched = 0;
    while (enumObj->Next(64, objIds, &fetched) == S_OK && fetched > 0) {
        for (DWORD i = 0; i < fetched; i++) {
            IPortableDeviceProperties* props = nullptr;
            content->Properties(&props);
            IPortableDeviceKeyCollection* keys = nullptr;
            CoCreateInstance(CLSID_PortableDeviceKeyCollection, nullptr, CLSCTX_INPROC_SERVER,
                             IID_PPV_ARGS(&keys));
            keys->Add(WPD_OBJECT_ORIGINAL_FILE_NAME);
            keys->Add(WPD_OBJECT_SIZE);
            keys->Add(WPD_OBJECT_DATE_MODIFIED);
            IPortableDeviceValues* vals = nullptr;
            props->GetValues(objIds[i], keys, &vals);
            keys->Release();
            props->Release();

            FileEntry entry;
            entry.objectId = objIds[i];

            LPWSTR fname = nullptr;
            vals->GetStringValue(WPD_OBJECT_ORIGINAL_FILE_NAME, &fname);
            entry.filename = fname ? fname : L"";
            if (fname) CoTaskMemFree(fname);

            ULONGLONG sz = 0;
            vals->GetUnsignedLargeIntegerValue(WPD_OBJECT_SIZE, &sz);
            entry.filesize = sz;

            PROPVARIANT pv;
            PropVariantInit(&pv);
            if (SUCCEEDED(vals->GetValue(WPD_OBJECT_DATE_MODIFIED, &pv)) && pv.vt == VT_DATE) {
                SYSTEMTIME st;
                VariantTimeToSystemTime(pv.date, &st);
                SystemTimeToFileTime(&st, &entry.mtime);
            } else {
                entry.mtime = {0, 0};
            }
            PropVariantClear(&pv);
            vals->Release();

            if (minSize == 0 || entry.filesize >= minSize) {
                files.push_back(entry);
            }
            CoTaskMemFree(objIds[i]);
        }
        fetched = 0;
    }
    enumObj->Release();
    return files;
}

static bool DownloadFile(IPortableDeviceContent* content, const std::wstring& objectId,
                          const std::string& destPath) {
    IPortableDeviceResources* resources = nullptr;
    content->Transfer(&resources);
    if (!resources) return false;

    IStream* stream = nullptr;
    DWORD optimalSize = 0;
    HRESULT hr = resources->GetStream(objectId.c_str(), WPD_RESOURCE_DEFAULT, STGM_READ,
                                       &optimalSize, &stream);
    resources->Release();
    if (FAILED(hr) || !stream) return false;

    std::ofstream out(destPath, std::ios::binary);
    if (!out) { stream->Release(); return false; }

    std::vector<BYTE> buf(optimalSize > 0 ? optimalSize : 65536);
    ULONG bytesRead = 0;
    while (stream->Read(buf.data(), (ULONG)buf.size(), &bytesRead) == S_OK && bytesRead > 0) {
        out.write(reinterpret_cast<char*>(buf.data()), bytesRead);
    }
    stream->Release();
    return true;
}

static std::string EscapeJson(const std::string& s) {
    std::string out;
    for (char c : s) {
        if (c == '\\') out += "\\\\";
        else if (c == '"') out += "\\\"";
        else out += c;
    }
    return out;
}

int wmain(int argc, wchar_t* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: garmin_mtp_windows <dest_dir> [count] [offset]" << std::endl;
        return 3;
    }

    std::wstring destDirW = argv[1];
    std::string destDir = WideToUtf8(destDirW);
    int count = argc > 2 ? _wtoi(argv[2]) : 10;
    int offset = argc > 3 ? _wtoi(argv[3]) : 0;

    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    IPortableDeviceManager* mgr = nullptr;
    CoCreateInstance(CLSID_PortableDeviceManager, nullptr, CLSCTX_INPROC_SERVER,
                     IID_PPV_ARGS(&mgr));
    if (!mgr) { std::cerr << "Failed to create device manager" << std::endl; return 2; }

    std::wstring deviceId = FindGarminDevice(mgr);
    mgr->Release();
    if (deviceId.empty()) { std::cerr << "No Garmin device found" << std::endl; return 1; }

    IPortableDevice* device = OpenDevice(deviceId);
    if (!device) { std::cerr << "Failed to open device" << std::endl; return 2; }

    IPortableDeviceContent* content = nullptr;
    device->Content(&content);
    if (!content) { device->Release(); return 2; }

    // Navigate: root → GARMIN → ACTIVITY / SCORECARD / CLUBS
    std::wstring garminFolder = FindFolder(content, WPD_DEVICE_OBJECT_ID, L"GARMIN");
    if (garminFolder.empty()) {
        // Try root-level folders
        garminFolder = FindFolder(content, WPD_DEVICE_OBJECT_ID, L"Garmin");
    }
    if (garminFolder.empty()) {
        std::cerr << "GARMIN folder not found on device" << std::endl;
        content->Release(); device->Release();
        return 1;
    }

    std::wstring actFolder = FindFolder(content, garminFolder, L"ACTIVITY");
    std::wstring scFolder = FindFolder(content, garminFolder, L"SCORECARD");
    std::wstring clubsFolder = FindFolder(content, garminFolder, L"CLUBS");

    if (actFolder.empty() || scFolder.empty()) {
        std::cerr << "ACTIVITY or SCORECARD folder not found" << std::endl;
        content->Release(); device->Release();
        return 1;
    }

    // Download Clubs.fit
    std::string clubsDest;
    if (!clubsFolder.empty()) {
        auto clubFiles = ListFiles(content, clubsFolder);
        for (auto& cf : clubFiles) {
            if (WideToUtf8(cf.filename) == "Clubs.fit") {
                clubsDest = destDir + "\\Clubs.fit";
                DownloadFile(content, cf.objectId, clubsDest);
                break;
            }
        }
    }

    // List scorecard and activity files
    auto scFiles = ListFiles(content, scFolder);
    auto actFiles = ListFiles(content, actFolder, MIN_GOLF_SIZE);

    // Sort by mtime descending
    auto sortByMtime = [](const FileEntry& a, const FileEntry& b) {
        ULARGE_INTEGER ua, ub;
        ua.LowPart = a.mtime.dwLowDateTime; ua.HighPart = a.mtime.dwHighDateTime;
        ub.LowPart = b.mtime.dwLowDateTime; ub.HighPart = b.mtime.dwHighDateTime;
        return ua.QuadPart > ub.QuadPart;
    };
    std::sort(scFiles.begin(), scFiles.end(), sortByMtime);
    std::sort(actFiles.begin(), actFiles.end(), sortByMtime);

    // Match and download
    std::cout << "[" << std::endl;
    int downloaded = 0, skipped = 0;

    for (auto& sc : scFiles) {
        if (downloaded >= count) break;

        long long scTime = FiletimeToUnix(sc.mtime);

        // Find closest activity by mtime
        FileEntry* bestAct = nullptr;
        long long bestDiff = 999999;
        for (auto& act : actFiles) {
            long long diff = std::abs(FiletimeToUnix(act.mtime) - scTime);
            if (diff < bestDiff) { bestDiff = diff; bestAct = &act; }
        }
        if (!bestAct || bestDiff > 3600) continue;
        if (skipped < offset) { skipped++; continue; }

        std::string scName = WideToUtf8(sc.filename);
        std::string actName = WideToUtf8(bestAct->filename);
        std::string scDest = destDir + "\\" + scName;
        std::string actDest = destDir + "\\" + actName;

        if (!DownloadFile(content, sc.objectId, scDest)) {
            std::cerr << "Failed to download " << scName << std::endl;
            continue;
        }
        if (!DownloadFile(content, bestAct->objectId, actDest)) {
            std::cerr << "Failed to download " << actName << std::endl;
            continue;
        }

        if (downloaded > 0) std::cout << "," << std::endl;
        std::cout << "  {" << std::endl;
        std::cout << "    \"scorecard\": \"" << EscapeJson(scDest) << "\"," << std::endl;
        std::cout << "    \"scorecard_name\": \"" << EscapeJson(scName) << "\"," << std::endl;
        std::cout << "    \"scorecard_mtime\": " << scTime << "," << std::endl;
        std::cout << "    \"activity\": \"" << EscapeJson(actDest) << "\"," << std::endl;
        std::cout << "    \"activity_name\": \"" << EscapeJson(actName) << "\"," << std::endl;
        std::cout << "    \"activity_mtime\": " << FiletimeToUnix(bestAct->mtime) << "," << std::endl;
        std::cout << "    \"activity_size\": " << bestAct->filesize << "," << std::endl;
        std::cout << "    \"clubs_path\": \"" << EscapeJson(clubsDest) << "\"" << std::endl;
        std::cout << "  }";
        downloaded++;
    }

    std::cout << std::endl << "]" << std::endl;

    content->Release();
    device->Release();
    CoUninitialize();

    return downloaded > 0 ? 0 : 1;
}
