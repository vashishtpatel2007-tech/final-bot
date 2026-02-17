"""
FastAPI main application — ties everything together.
Run locally: uvicorn main:app --reload --port 8000
"""
import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from database import init_db
from auth import router as auth_router
from chat import router as chat_router
from conversations import router as conv_router
from drive_sync import background_sync_loop, sync_all
from rag import get_stats


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    # Initialize database
    await init_db()

    # Run initial Drive sync
    print("🚀 Running initial Drive sync...")
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, sync_all)
    except Exception as e:
        print(f"⚠️  Initial sync failed (will retry later): {e}")

    # Start background sync task
    sync_task = asyncio.create_task(background_sync_loop(interval_minutes=1))

    yield

    # Shutdown
    sync_task.cancel()


app = FastAPI(
    title="BMSIT Academic Chatbot API",
    description="AI-powered academic assistant for BMSIT engineering students",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow frontend
frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth_router)
app.include_router(chat_router)
app.include_router(conv_router)


@app.get("/")
async def health():
    stats = get_stats()
    return {
        "status": "running",
        "app": "BMSIT Academic Chatbot",
        "vector_store": stats,
    }


@app.post("/sync")
async def trigger_sync():
    """Manually trigger a Drive sync (for testing)."""
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, sync_all)
        return result
    except Exception as e:
        return {"status": "error", "detail": str(e)}
