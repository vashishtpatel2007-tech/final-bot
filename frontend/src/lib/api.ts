/**
 * API client — handles all communication with the FastAPI backend.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Token Management ──────────────────────────────────────────

function getToken(): string | null {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("token");
}

function setToken(token: string): void {
    localStorage.setItem("token", token);
}

function clearToken(): void {
    localStorage.removeItem("token");
}

// ── Base Fetch ────────────────────────────────────────────────

async function apiFetch(path: string, options: RequestInit = {}) {
    const token = getToken();
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers,
    });

    if (res.status === 401) {
        clearToken();
        if (typeof window !== "undefined") {
            window.location.href = "/login";
        }
        throw new Error("Unauthorized");
    }

    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Request failed" }));
        throw new Error(error.detail || "Request failed");
    }

    return res.json();
}

// ── Auth ──────────────────────────────────────────────────────

export interface User {
    id: number;
    email: string;
    name: string;
}

export async function signup(data: {
    email: string;
    name: string;
    password: string;
}): Promise<{ token: string; user: User }> {
    const result = await apiFetch("/auth/signup", {
        method: "POST",
        body: JSON.stringify(data),
    });
    setToken(result.token);
    return result;
}

export async function login(
    email: string,
    password: string
): Promise<{ token: string; user: User }> {
    const result = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
    });
    setToken(result.token);
    return result;
}

export async function forgotPassword(email: string): Promise<{ message: string }> {
    return apiFetch("/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
    });
}

export async function getMe(): Promise<User> {
    return apiFetch("/auth/me");
}

export function logout(): void {
    clearToken();
    window.location.href = "/login";
}

export function isLoggedIn(): boolean {
    return !!getToken();
}

// ── Chat ──────────────────────────────────────────────────────

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    sources?: Source[];
}

export interface Source {
    filename: string;
    type: string;
    drive_link?: string;
}

export async function sendMessage(
    message: string,
    mode: string,
    year: number,
    stream: string,
    conversationHistory: ChatMessage[] = []
): Promise<{ response: string; sources: Source[] }> {
    return apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({
            message,
            mode,
            year,
            stream,
            conversation_history: conversationHistory.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        }),
    });
}

export async function sendMessageStream(
    message: string,
    mode: string,
    year: number,
    stream: string,
    conversationHistory: ChatMessage[],
    onChunk: (text: string) => void,
    onDone: (sources: Source[]) => void,
    onError: (error: string) => void
): Promise<void> {
    const token = getToken();
    const res = await fetch(`${API_URL}/chat/stream`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            message,
            mode,
            year,
            stream,
            conversation_history: conversationHistory.map((m) => ({
                role: m.role,
                content: m.content,
            })),
        }),
    });

    if (!res.ok) {
        const error = await res.json().catch(() => ({ detail: "Stream failed" }));
        onError(error.detail || "Stream failed");
        return;
    }

    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
        onError("No response body");
        return;
    }

    let buffer = "";
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
            if (line.startsWith("data: ")) {
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === "chunk") {
                        onChunk(data.content);
                    } else if (data.type === "done") {
                        onDone(data.sources || []);
                    } else if (data.type === "error") {
                        onError(data.content);
                    }
                } catch {
                    // skip malformed lines
                }
            }
        }
    }
}

// ── Conversations ─────────────────────────────────────────────

export interface Conversation {
    id: number;
    title: string;
    mode: string;
    messages?: ChatMessage[];
    created_at: string;
    updated_at: string;
}

export async function listConversations(): Promise<Conversation[]> {
    return apiFetch("/conversations/");
}

export async function createConversation(
    title: string = "New Chat",
    mode: string = "study_buddy"
): Promise<Conversation> {
    return apiFetch("/conversations/", {
        method: "POST",
        body: JSON.stringify({ title, mode }),
    });
}

export async function getConversation(id: number): Promise<Conversation> {
    return apiFetch(`/conversations/${id}`);
}

export async function updateConversation(
    id: number,
    data: { title?: string; messages_json?: string; mode?: string }
): Promise<void> {
    return apiFetch(`/conversations/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
    });
}

export async function deleteConversation(id: number): Promise<void> {
    return apiFetch(`/conversations/${id}`, {
        method: "DELETE",
    });
}
