"""
Conversations CRUD — list, create, update, delete user's chat conversations.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import json

from auth import get_current_user
from database import get_db

router = APIRouter(prefix="/conversations", tags=["conversations"])


class ConversationCreate(BaseModel):
    title: str = "New Chat"
    mode: str = "study_buddy"

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    messages_json: Optional[str] = None
    mode: Optional[str] = None


@router.get("/")
async def list_conversations(user=Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
            (user["id"],),
        )
        rows = await cursor.fetchall()
        return [
            {"id": r[0], "title": r[1], "mode": r[2], "created_at": r[3], "updated_at": r[4]}
            for r in rows
        ]
    finally:
        await db.close()


@router.post("/")
async def create_conversation(req: ConversationCreate, user=Depends(get_current_user)):
    db = await get_db()
    try:
        await db.execute(
            "INSERT INTO conversations (user_id, title, mode) VALUES (?, ?, ?)",
            (user["id"], req.title, req.mode),
        )
        await db.commit()
        cursor = await db.execute("SELECT last_insert_rowid()")
        row = await cursor.fetchone()
        conv_id = row[0]
    finally:
        await db.close()

    return {"id": conv_id, "title": req.title, "mode": req.mode, "messages": []}


@router.get("/{conv_id}")
async def get_conversation(conv_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT id, title, messages_json, mode, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?",
            (conv_id, user["id"]),
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Conversation not found")
        return {
            "id": row[0],
            "title": row[1],
            "messages": json.loads(row[2]) if row[2] else [],
            "mode": row[3],
            "created_at": row[4],
            "updated_at": row[5],
        }
    finally:
        await db.close()


@router.put("/{conv_id}")
async def update_conversation(conv_id: int, req: ConversationUpdate, user=Depends(get_current_user)):
    db = await get_db()
    try:
        # Verify ownership
        cursor = await db.execute(
            "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
            (conv_id, user["id"]),
        )
        if not await cursor.fetchone():
            raise HTTPException(status_code=404, detail="Conversation not found")

        updates = []
        values = []
        if req.title is not None:
            updates.append("title = ?")
            values.append(req.title)
        if req.messages_json is not None:
            updates.append("messages_json = ?")
            values.append(req.messages_json)
        if req.mode is not None:
            updates.append("mode = ?")
            values.append(req.mode)

        updates.append("updated_at = CURRENT_TIMESTAMP")
        values.append(conv_id)

        await db.execute(
            f"UPDATE conversations SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        await db.commit()
    finally:
        await db.close()

    return {"status": "updated"}


@router.delete("/{conv_id}")
async def delete_conversation(conv_id: int, user=Depends(get_current_user)):
    db = await get_db()
    try:
        cursor = await db.execute(
            "DELETE FROM conversations WHERE id = ? AND user_id = ?",
            (conv_id, user["id"]),
        )
        await db.commit()
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Conversation not found")
    finally:
        await db.close()

    return {"status": "deleted"}
