#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <libmtp.h>

#define MIN_GOLF_SIZE 50000
#define MAX_ROUNDS    100

typedef struct {
    uint32_t id;
    char     filename[64];
    uint64_t filesize;
    time_t   mtime;
} FileEntry;

static int cmp_id_desc(const void *a, const void *b) {
    const FileEntry *fa = (const FileEntry *)a;
    const FileEntry *fb = (const FileEntry *)b;
    return (fb->id > fa->id) - (fb->id < fa->id);
}

// Walk the file tree recursively to find a folder named `target`
// under a parent folder named `parent_name` (or any parent if parent_name is NULL).
// Returns the folder_id or 0 if not found.
static uint32_t find_folder_id(LIBMTP_mtpdevice_t *dev,
                                LIBMTP_devicestorage_t *storage,
                                uint32_t leaf,
                                const char *parent_name,
                                const char *target,
                                int in_parent)
{
    LIBMTP_file_t *files = LIBMTP_Get_Files_And_Folders(dev, storage->id, leaf);
    LIBMTP_file_t *f = files;
    uint32_t found = 0;

    while (f && !found) {
        if (f->filetype == LIBMTP_FILETYPE_FOLDER) {
            int now_in_parent = in_parent ||
                (parent_name && strcmp(f->filename, parent_name) == 0);

            if (now_in_parent && strcmp(f->filename, target) == 0) {
                found = f->item_id;
            } else {
                found = find_folder_id(dev, storage, f->item_id,
                                       parent_name, target, now_in_parent);
            }
        }
        LIBMTP_file_t *next = f->next;
        LIBMTP_destroy_file_t(f);
        f = next;
    }
    // Free remaining nodes if we broke early
    while (f) {
        LIBMTP_file_t *next = f->next;
        LIBMTP_destroy_file_t(f);
        f = next;
    }
    return found;
}

int main(int argc, char *argv[]) {
    const char *dest_dir = argc > 1 ? argv[1] : "/tmp";
    char *end;
    int count  = argc > 2 ? (int)strtol(argv[2], &end, 10) : 1;
    if (argc > 2 && (end == argv[2] || *end != '\0')) count = 1;
    int offset = argc > 3 ? (int)strtol(argv[3], &end, 10) : 0;
    if (argc > 3 && (end == argv[3] || *end != '\0')) offset = 0;
    if (count < 1 || count > MAX_ROUNDS) count = 1;

    // Redirect libmtp noise to stderr
    FILE *saved = fdopen(dup(fileno(stdout)), "w");
    freopen("/dev/stderr", "w", stdout);
    LIBMTP_Init();
    LIBMTP_Set_Debug(0);
    dup2(fileno(saved), fileno(stdout));
    fclose(saved);

    LIBMTP_raw_device_t *rawdevs;
    int numdevs;
    if (LIBMTP_Detect_Raw_Devices(&rawdevs, &numdevs) != 0 || numdevs == 0) {
        fprintf(stderr, "No MTP device found\n"); return 1;
    }

    LIBMTP_mtpdevice_t *dev = LIBMTP_Open_Raw_Device_Uncached(&rawdevs[0]);
    if (!dev) { fprintf(stderr, "Failed to open device\n"); return 1; }

    if (LIBMTP_Get_Storage(dev, LIBMTP_STORAGE_SORTBY_NOTSORTED) != 0) {
        fprintf(stderr, "Failed to get storage\n");
        LIBMTP_Release_Device(dev); return 1;
    }
    LIBMTP_devicestorage_t *storage = dev->storage;
    if (!storage) {
        fprintf(stderr, "No storage found\n");
        LIBMTP_Release_Device(dev); return 1;
    }

    // Dynamically resolve folder IDs by walking the tree
    uint32_t folder_scorcrds = find_folder_id(dev, storage,
        LIBMTP_FILES_AND_FOLDERS_ROOT, "GARMIN", "SCORCRDS", 0);
    uint32_t folder_activity = find_folder_id(dev, storage,
        LIBMTP_FILES_AND_FOLDERS_ROOT, "GARMIN", "Activity", 0);
    uint32_t folder_clubs    = find_folder_id(dev, storage,
        LIBMTP_FILES_AND_FOLDERS_ROOT, "GARMIN", "Clubs", 0);

    // Fall back to env vars or hardcoded defaults
    if (!folder_scorcrds) { const char *e = getenv("GARMIN_FOLDER_SCORCRDS");
        folder_scorcrds = e ? (uint32_t)strtoul(e, NULL, 10) : 16777263; }
    if (!folder_activity) { const char *e = getenv("GARMIN_FOLDER_ACTIVITY");
        folder_activity = e ? (uint32_t)strtoul(e, NULL, 10) : 16777249; }
    if (!folder_clubs)    { const char *e = getenv("GARMIN_FOLDER_CLUBS");
        folder_clubs    = e ? (uint32_t)strtoul(e, NULL, 10) : 16777264; }

    fprintf(stderr, "[folders] SCORCRDS=%u Activity=%u Clubs=%u\n",
            folder_scorcrds, folder_activity, folder_clubs);

    // Collect scorecard files
    FileEntry sc_files[MAX_ROUNDS * 2];
    int sc_count = 0;
    LIBMTP_file_t *f = LIBMTP_Get_Files_And_Folders(dev, storage->id, folder_scorcrds);
    while (f && sc_count < MAX_ROUNDS * 2) {
        if (f->filesize > 0) {
            sc_files[sc_count].id       = f->item_id;
            sc_files[sc_count].filesize = f->filesize;
            sc_files[sc_count].mtime    = f->modificationdate;
            strncpy(sc_files[sc_count].filename, f->filename, 63);
            sc_files[sc_count].filename[63] = '\0';
            sc_count++;
        }
        f = f->next;
    }
    qsort(sc_files, sc_count, sizeof(FileEntry), cmp_id_desc);

    // Download Clubs.fit
    char clubs_dest[512] = "";
    if (folder_clubs) {
        LIBMTP_file_t *cf = LIBMTP_Get_Files_And_Folders(dev, storage->id, folder_clubs);
        while (cf) {
            if (strcmp(cf->filename, "Clubs.fit") == 0) {
                snprintf(clubs_dest, sizeof(clubs_dest), "%s/Clubs.fit", dest_dir);
                if (LIBMTP_Get_File_To_File(dev, cf->item_id, clubs_dest, NULL, NULL) != 0) {
                    fprintf(stderr, "Failed to download Clubs.fit\n");
                    clubs_dest[0] = '\0';
                }
                break;
            }
            cf = cf->next;
        }
    }

    // Collect activity files
    FileEntry act_files[MAX_ROUNDS * 10];
    int act_count = 0;
    LIBMTP_file_t *a = LIBMTP_Get_Files_And_Folders(dev, storage->id, folder_activity);
    while (a && act_count < MAX_ROUNDS * 10) {
        if (a->filesize >= MIN_GOLF_SIZE) {
            act_files[act_count].id       = a->item_id;
            act_files[act_count].filesize = a->filesize;
            act_files[act_count].mtime    = a->modificationdate;
            strncpy(act_files[act_count].filename, a->filename, 63);
            act_files[act_count].filename[63] = '\0';
            act_count++;
        }
        a = a->next;
    }

    printf("[\n");
    int downloaded = 0, skipped = 0;

    for (int i = 0; i < sc_count && downloaded < count; i++) {
        FileEntry *sc = &sc_files[i];

        FileEntry *best_act = NULL;
        long best_diff = 999999;
        for (int j = 0; j < act_count; j++) {
            long diff = labs((long)act_files[j].mtime - (long)sc->mtime);
            if (diff < best_diff) { best_diff = diff; best_act = &act_files[j]; }
        }
        if (!best_act || best_diff > 3600) continue;
        if (skipped < offset) { skipped++; continue; }

        char sc_dest[512], act_dest[512];
        snprintf(sc_dest,  sizeof(sc_dest),  "%s/%s", dest_dir, sc->filename);
        snprintf(act_dest, sizeof(act_dest), "%s/%s", dest_dir, best_act->filename);

        if (LIBMTP_Get_File_To_File(dev, sc->id, sc_dest, NULL, NULL) != 0) {
            fprintf(stderr, "Failed to download scorecard %s\n", sc->filename);
            continue;
        }
        if (LIBMTP_Get_File_To_File(dev, best_act->id, act_dest, NULL, NULL) != 0) {
            fprintf(stderr, "Failed to download activity %s\n", best_act->filename);
            continue;
        }

        if (downloaded > 0) printf(",\n");
        printf("  {\n");
        printf("    \"scorecard\": \"%s\",\n",      sc_dest);
        printf("    \"scorecard_name\": \"%s\",\n", sc->filename);
        printf("    \"scorecard_mtime\": %ld,\n",   (long)sc->mtime);
        printf("    \"activity\": \"%s\",\n",        act_dest);
        printf("    \"activity_name\": \"%s\",\n",  best_act->filename);
        printf("    \"activity_mtime\": %ld,\n",    (long)best_act->mtime);
        printf("    \"activity_size\": %llu,\n",    (unsigned long long)best_act->filesize);
        printf("    \"clubs_path\": \"%s\"\n",       clubs_dest);
        printf("  }");

        downloaded++;
    }

    printf("\n]\n");
    LIBMTP_Release_Device(dev);
    return downloaded > 0 ? 0 : 1;
}
