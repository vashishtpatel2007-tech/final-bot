"""
Google Drive sync module — downloads files from shared Drive folders and ingests them into ChromaDB.
Folder structure: Branch (CSE/ECE/AIML/MECH) → Year 1/2/3/4 → files

Uses a Google Service Account for access. Teachers share their Drive folders with the service account email.
"""
import os
import re
import json
import tempfile
import asyncio
from datetime import datetime
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload
from google.oauth2 import service_account
import io

from rag import ingest_document

# Supported file types
SUPPORTED_MIMES = {
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/msword": ".doc",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.ms-powerpoint": ".ppt",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/bmp": ".bmp",
    "text/plain": ".txt",
    "text/csv": ".csv",
    # Google Docs/Sheets/Slides will be exported as PDF
    "application/vnd.google-apps.document": ".gdoc",
    "application/vnd.google-apps.spreadsheet": ".gsheet",
    "application/vnd.google-apps.presentation": ".gslide",
}

# Mapping of stream names to env variable names for folder IDs
STREAM_FOLDER_ENV = {
    "CSE": "DRIVE_CSE_FOLDER_ID",
    "ECE": "DRIVE_ECE_FOLDER_ID",
    "AIML": "DRIVE_AIML_FOLDER_ID",
    "MECH": "DRIVE_MECH_FOLDER_ID",
}


def _get_drive_service():
    """Build Google Drive API service using service account credentials."""
    creds_path = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "service-account.json")
    if not os.path.exists(creds_path):
        print(f"⚠️  Service account file not found: {creds_path}")
        return None

    creds = service_account.Credentials.from_service_account_file(
        creds_path, scopes=["https://www.googleapis.com/auth/drive.readonly"]
    )
    return build("drive", "v3", credentials=creds)


def _detect_year_from_folder_name(name: str) -> int:
    """Extract year number from folder name. E.g., '1st Year' → 1, 'Year 2' → 2, '3' → 3."""
    # Match patterns like "1st year", "year 2", "2nd", "3", "year-3", "1st_year"
    match = re.search(r'(\d)', name)
    if match:
        year = int(match.group(1))
        if 1 <= year <= 4:
            return year
    return 0


def _list_folder_children(service, folder_id: str) -> list:
    """List all files and subfolders in a Drive folder."""
    results = []
    page_token = None
    while True:
        response = service.files().list(
            q=f"'{folder_id}' in parents and trashed = false",
            spaces="drive",
            fields="nextPageToken, files(id, name, mimeType, webViewLink, modifiedTime)",
            pageToken=page_token,
            pageSize=100,
        ).execute()
        results.extend(response.get("files", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break
    return results


def _download_file(service, file_id: str, mime_type: str, filename: str) -> str:
    """Download a file from Drive to a temp path. Exports Google Docs as PDF."""
    ext = SUPPORTED_MIMES.get(mime_type, "")
    suffix = ext if ext else os.path.splitext(filename)[1]

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)

    if mime_type in ("application/vnd.google-apps.document",
                     "application/vnd.google-apps.spreadsheet",
                     "application/vnd.google-apps.presentation"):
        # Export Google Docs/Sheets/Slides as PDF
        request = service.files().export_media(fileId=file_id, mimeType="application/pdf")
        tmp.name = tmp.name.replace(suffix, ".pdf") if suffix else tmp.name + ".pdf"
    else:
        request = service.files().get_media(fileId=file_id)

    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()

    with open(tmp.name, "wb") as f:
        f.write(fh.getvalue())

    return tmp.name


def _get_doc_type(folder_name: str) -> str:
    """Guess document type from subfolder name."""
    name = folder_name.lower()
    if "syllabus" in name:
        return "syllabus"
    elif "timetable" in name or "schedule" in name:
        return "timetable"
    elif "question" in name or "exam" in name or "paper" in name:
        return "question_paper"
    elif "note" in name:
        return "notes"
    elif "assignment" in name:
        return "assignment"
    else:
        return "notes"


def sync_all():
    """Main sync function — scans all branch folders and ingests new files."""
    service = _get_drive_service()
    if not service:
        print("❌ Drive sync skipped: no service account configured")
        return {"status": "skipped", "reason": "no service account"}

    total_ingested = 0
    stats = {}

    for stream, env_key in STREAM_FOLDER_ENV.items():
        folder_id = os.getenv(env_key, "")
        if not folder_id:
            print(f"⏭️  No folder ID for {stream}, skipping")
            continue

        print(f"\n📂 Syncing {stream}...")
        stats[stream] = {"files": 0, "chunks": 0}

        # List year subfolders
        year_folders = _list_folder_children(service, folder_id)

        for year_folder in year_folders:
            if year_folder["mimeType"] != "application/vnd.google-apps.folder":
                continue

            year = _detect_year_from_folder_name(year_folder["name"])
            if year == 0:
                print(f"  ⚠️  Can't detect year from folder: {year_folder['name']}")
                continue

            print(f"  📁 {stream} → Year {year}")

            # Files directly in the year folder
            year_files = _list_folder_children(service, year_folder["id"])

            for item in year_files:
                if item["mimeType"] == "application/vnd.google-apps.folder":
                    # It's a subfolder (e.g., "Notes", "Syllabus") — scan inside
                    doc_type = _get_doc_type(item["name"])
                    sub_files = _list_folder_children(service, item["id"])

                    for sub_file in sub_files:
                        if sub_file["mimeType"] in SUPPORTED_MIMES or sub_file["mimeType"] not in ("application/vnd.google-apps.folder",):
                            chunks = _process_file(service, sub_file, stream, year, doc_type)
                            stats[stream]["files"] += 1
                            stats[stream]["chunks"] += chunks
                            total_ingested += chunks
                else:
                    # Direct file in year folder
                    if item["mimeType"] in SUPPORTED_MIMES:
                        chunks = _process_file(service, item, stream, year, "notes")
                        stats[stream]["files"] += 1
                        stats[stream]["chunks"] += chunks
                        total_ingested += chunks

    print(f"\n✅ Sync complete! Total chunks ingested: {total_ingested}")
    return {"status": "complete", "total_chunks": total_ingested, "details": stats}


def _process_file(service, file_info: dict, stream: str, year: int, doc_type: str) -> int:
    """Download and ingest a single file."""
    try:
        file_id = file_info["id"]
        filename = file_info["name"]
        mime_type = file_info["mimeType"]
        drive_link = file_info.get("webViewLink", "")

        print(f"    📄 {filename}")

        # Download to temp
        tmp_path = _download_file(service, file_id, mime_type, filename)

        # Ingest
        chunks = ingest_document(
            file_path=tmp_path,
            stream=stream,
            year=year,
            doc_type=doc_type,
            filename=filename,
            drive_link=drive_link,
            file_id=file_id,
        )

        # Clean up temp file
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

        return chunks

    except Exception as e:
        print(f"    ❌ Error processing {file_info.get('name', '???')}: {e}")
        return 0


async def background_sync_loop(interval_minutes: int = 30):
    """Run sync in a background loop every N minutes."""
    while True:
        print(f"\n🔄 Starting Drive sync at {datetime.now().isoformat()}")
        try:
            # Run sync in a thread to not block the async event loop
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, sync_all)
        except Exception as e:
            print(f"❌ Sync error: {e}")

        print(f"⏰ Next sync in {interval_minutes} minutes")
        await asyncio.sleep(interval_minutes * 60)
