"""
Chat endpoint — takes a message + mode, retrieves relevant context via RAG,
and generates a response using Gemini API with streaming.
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import os
import json
import google.generativeai as genai

from auth import get_current_user
from rag import query as rag_query
from prompts import get_system_prompt

router = APIRouter(tags=["chat"])

# Configure Gemini
genai.configure(api_key=os.getenv("GEMINI_API_KEY", ""))


class ChatRequest(BaseModel):
    message: str
    mode: str = "study_buddy"  # study_buddy, the_bro, professor, eli5
    year: int = 1  # 1, 2, 3, or 4 — selected on the dashboard
    stream: str = "CSE"  # CSE, ECE, AIML, MECH — selected on the dashboard
    conversation_history: list = []  # Previous messages for context


class ChatResponse(BaseModel):
    response: str
    sources: list = []
    mode: str = ""


@router.post("/chat")
async def chat(req: ChatRequest, user=Depends(get_current_user)):
    """Main chat endpoint. Uses user's year + stream to filter RAG results."""

    if req.mode not in ("study_buddy", "the_bro", "professor", "eli5"):
        req.mode = "study_buddy"

    user_year = req.year
    user_stream = req.stream

    # 1. Retrieve relevant context from ChromaDB
    rag_results = rag_query(
        question=req.message,
        stream=user_stream,
        year=user_year,
        top_k=5,
    )

    # 2. Format context for the prompt
    if rag_results:
        context_parts = []
        sources = []
        for i, doc in enumerate(rag_results):
            link_line = f"\n📎 Google Drive Link: {doc['drive_link']}" if doc.get('drive_link') else ""
            context_parts.append(
                f"[Source {i+1}: {doc['filename']} (type: {doc['type']})]{link_line}\n{doc['content']}"
            )
            source_info = {
                "filename": doc["filename"],
                "type": doc["type"],
            }
            if doc.get("drive_link"):
                source_info["drive_link"] = doc["drive_link"]
            if source_info not in sources:
                sources.append(source_info)

        context = "\n\n---\n\n".join(context_parts)
    else:
        context = "No relevant academic materials found for this query."
        sources = []

    # 3. Build system prompt with mode personality + context
    system_prompt = get_system_prompt(req.mode, context)

    # 4. Build conversation history for Gemini
    gemini_history = []
    for msg in req.conversation_history[-10:]:  # Last 10 messages for context
        role = "user" if msg.get("role") == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg.get("content", "")]})

    # 5. Call Gemini API
    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=system_prompt,
        )

        chat_session = model.start_chat(history=gemini_history)
        response = chat_session.send_message(req.message)

        return {
            "response": response.text,
            "sources": sources,
            "mode": req.mode,
            "year": user_year,
            "stream": user_stream,
        }

    except Exception as e:
        print(f"Gemini API error: {e}")
        raise HTTPException(status_code=500, detail=f"AI generation failed: {str(e)}")


@router.post("/chat/stream")
async def chat_stream(req: ChatRequest, user=Depends(get_current_user)):
    """Streaming chat endpoint using Server-Sent Events."""

    if req.mode not in ("study_buddy", "the_bro", "professor", "eli5"):
        req.mode = "study_buddy"

    user_year = req.year
    user_stream = req.stream

    # Retrieve context
    rag_results = rag_query(
        question=req.message,
        stream=user_stream,
        year=user_year,
        top_k=5,
    )

    if rag_results:
        context_parts = []
        sources = []
        for i, doc in enumerate(rag_results):
            link_line = f"\n📎 Google Drive Link: {doc['drive_link']}" if doc.get('drive_link') else ""
            context_parts.append(f"[Source {i+1}: {doc['filename']} (type: {doc['type']})]{link_line}\n{doc['content']}")
            source_info = {"filename": doc["filename"], "type": doc["type"]}
            if doc.get("drive_link"):
                source_info["drive_link"] = doc["drive_link"]
            if source_info not in sources:
                sources.append(source_info)
        context = "\n\n---\n\n".join(context_parts)
    else:
        context = "No relevant academic materials found for this query."
        sources = []

    system_prompt = get_system_prompt(req.mode, context)

    gemini_history = []
    for msg in req.conversation_history[-10:]:
        role = "user" if msg.get("role") == "user" else "model"
        gemini_history.append({"role": role, "parts": [msg.get("content", "")]})

    async def generate():
        try:
            model = genai.GenerativeModel(
                "gemini-2.0-flash",
                system_instruction=system_prompt,
            )
            chat_session = model.start_chat(history=gemini_history)
            response = chat_session.send_message(req.message, stream=True)

            for chunk in response:
                if chunk.text:
                    data = json.dumps({"type": "chunk", "content": chunk.text})
                    yield f"data: {data}\n\n"

            # Send sources at the end
            data = json.dumps({"type": "done", "sources": sources})
            yield f"data: {data}\n\n"

        except Exception as e:
            data = json.dumps({"type": "error", "content": str(e)})
            yield f"data: {data}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
