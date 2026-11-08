
import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

COLLECTIONS = {
    "lecturers": DATA / "lecturers.jsonl",
    "lecturer_course_assignments":
        DATA / "lecturer_course_assignments.jsonl",
    "reference_sessions": DATA / "reference_sessions.jsonl",
}


def read_records(path):
    seen = set()
    records = []

    for line_number, line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), 1
    ):
        if not line.strip():
            continue

        doc = json.loads(line)
        key = doc.get("_id")

        if not isinstance(key, str) or not key:
            raise ValueError(
                f"{path.name}:{line_number} missing string _id"
            )

        if key in seen:
            raise ValueError(
                f"{path.name}:{line_number} duplicate _id {key}"
            )

        seen.add(key)
        records.append(doc)

    return records


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write missing records to Atlas"
    )

    args = parser.parse_args()

    records = {
        name: read_records(path)
        for name, path in COLLECTIONS.items()
    }

    for name, docs in records.items():
        print(f"{name}: {len(docs)} valid records")

    if not args.apply:
        print("DRY RUN ONLY. Use --apply to import.")
        return

    from dotenv import load_dotenv
    from pymongo import MongoClient, UpdateOne

    load_dotenv(ROOT / ".env")

    uri = os.getenv("MONGODB_URI")
    database = os.getenv("PLATFORM_DB", "platform_db")

    if not uri:
        raise SystemExit("MONGODB_URI is missing")

    client = MongoClient(
        uri,
        serverSelectionTimeoutMS=10000
    )

    client.admin.command("ping")

    db = client[database]

    for name, docs in records.items():
        operations = [
            UpdateOne(
                {"_id": doc["_id"]},
                {
                    "$setOnInsert": {
                        k: v
                        for k, v in doc.items()
                        if k != "_id"
                    }
                },
                upsert=True
            )
            for doc in docs
        ]

        if operations:
            result = db[name].bulk_write(
                operations,
                ordered=False
            )

            print(
                f"{name}: inserted={result.upserted_count}"
            )

    db["reference_sessions"].create_index(
        [("dayOfWeek", 1), ("roomCode", 1)]
    )

    db["reference_sessions"].create_index(
        "reportedLecturerIds"
    )

    db["reference_sessions"].create_index(
        "moduleCodes"
    )

    print("Import complete.")
    client.close()


if __name__ == "__main__":
    main()
