import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

_ENV_PATH = Path(__file__).resolve().parents[2] / ".env.local"
load_dotenv(_ENV_PATH)

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is not None:
        return _client

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError(
            "Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) or SUPABASE_SERVICE_ROLE_KEY in .env.local"
        )

    _client = create_client(url, key)
    return _client

