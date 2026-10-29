"""Entrypoint: ``uvicorn server:app``."""
from dotenv import load_dotenv

load_dotenv()

from tracker.api import create_app  # noqa: E402  (settings are read from the environment)

app = create_app()
