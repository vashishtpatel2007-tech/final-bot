"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
    getMe,
    logout,
    sendMessage,
    listConversations,
    createConversation,
    updateConversation,
    deleteConversation,
    getConversation,
    isLoggedIn,
    type User,
    type ChatMessage,
    type Conversation,
    type Source,
} from "@/lib/api";

// ── Mode definitions ──────────────────────────────────────────

const MODES = [
    {
        id: "study_buddy",
        name: "Study Buddy",
        emoji: "🎓",
        desc: "Friendly study partner",
        color: "from-emerald-500 to-teal-600",
    },
    {
        id: "the_bro",
        name: "The Bro",
        emoji: "😎",
        desc: "Your chill best friend",
        color: "from-orange-500 to-red-500",
    },
    {
        id: "professor",
        name: "Professor",
        emoji: "👨‍🏫",
        desc: "Formal academic expert",
        color: "from-blue-500 to-indigo-600",
    },
    {
        id: "eli5",
        name: "ELI5",
        emoji: "🧒",
        desc: "Explain like I'm 5",
        color: "from-pink-500 to-purple-500",
    },
];

const STREAMS = ["CSE", "ECE", "AIML", "MECH"];
const YEARS = [
    { value: 1, label: "1st Year" },
    { value: 2, label: "2nd Year" },
    { value: 3, label: "3rd Year" },
    { value: 4, label: "4th Year" },
];

export default function ChatPage() {
    const router = useRouter();

    // ── State ────────────────────────────────────────────────
    const [user, setUser] = useState<User | null>(null);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [activeConvId, setActiveConvId] = useState<number | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [input, setInput] = useState("");
    const [mode, setMode] = useState("study_buddy");
    const [year, setYear] = useState(1);
    const [stream, setStream] = useState("CSE");
    const [loading, setLoading] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [initialLoading, setInitialLoading] = useState(true);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // ── Auto-scroll ──────────────────────────────────────────
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // ── Auth check + load data ──────────────────────────────
    useEffect(() => {
        if (!isLoggedIn()) {
            router.push("/login");
            return;
        }

        const init = async () => {
            try {
                const me = await getMe();
                setUser(me);
                const convs = await listConversations();
                setConversations(convs);
            } catch {
                router.push("/login");
            } finally {
                setInitialLoading(false);
            }
        };
        init();
    }, [router]);

    // ── Load conversation messages ──────────────────────────
    const loadConversation = async (convId: number) => {
        try {
            const conv = await getConversation(convId);
            setMessages(conv.messages || []);
            setMode(conv.mode || "study_buddy");
            setActiveConvId(convId);
        } catch (err) {
            console.error("Failed to load conversation:", err);
        }
    };

    // ── New Chat ────────────────────────────────────────────
    const handleNewChat = async () => {
        try {
            const conv = await createConversation("New Chat", mode);
            setConversations((prev) => [conv, ...prev]);
            setActiveConvId(conv.id);
            setMessages([]);
        } catch (err) {
            console.error("Failed to create conversation:", err);
        }
    };

    // ── Delete conversation ─────────────────────────────────
    const handleDeleteConversation = async (convId: number) => {
        try {
            await deleteConversation(convId);
            setConversations((prev) => prev.filter((c) => c.id !== convId));
            if (activeConvId === convId) {
                setActiveConvId(null);
                setMessages([]);
            }
        } catch (err) {
            console.error("Failed to delete:", err);
        }
    };

    // ── Send message ────────────────────────────────────────
    const handleSend = async () => {
        if (!input.trim() || loading) return;

        const userMessage: ChatMessage = { role: "user", content: input.trim() };
        const newMessages = [...messages, userMessage];
        setMessages(newMessages);
        setInput("");
        setLoading(true);

        // Create conversation if none active
        let convId = activeConvId;
        if (!convId) {
            try {
                const title = input.trim().slice(0, 50) + (input.trim().length > 50 ? "..." : "");
                const conv = await createConversation(title, mode);
                convId = conv.id;
                setActiveConvId(conv.id);
                setConversations((prev) => [{ ...conv, title }, ...prev]);
            } catch {
                setLoading(false);
                return;
            }
        }

        try {
            const result = await sendMessage(input.trim(), mode, year, stream, messages);
            const assistantMessage: ChatMessage = {
                role: "assistant",
                content: result.response,
                sources: result.sources,
            };
            const updatedMessages = [...newMessages, assistantMessage];
            setMessages(updatedMessages);

            // Save to backend
            if (convId) {
                await updateConversation(convId, {
                    messages_json: JSON.stringify(updatedMessages),
                    mode,
                });
            }
        } catch (err: any) {
            const errorMessage: ChatMessage = {
                role: "assistant",
                content: `⚠️ Error: ${err.message || "Something went wrong. Please try again."}`,
            };
            setMessages([...newMessages, errorMessage]);
        } finally {
            setLoading(false);
            inputRef.current?.focus();
        }
    };

    // ── Handle Enter key ───────────────────────────────────
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // ── Loading state ───────────────────────────────────────
    if (initialLoading) {
        return (
            <div className="min-h-screen bg-slate-900 flex items-center justify-center">
                <div className="text-center">
                    <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading...</p>
                </div>
            </div>
        );
    }

    const currentMode = MODES.find((m) => m.id === mode) || MODES[0];

    return (
        <div className="h-screen flex bg-slate-900 text-white overflow-hidden">
            {/* ─── Sidebar ──────────────────────────────────────── */}
            <div
                className={`${sidebarOpen ? "w-72" : "w-0"
                    } transition-all duration-300 bg-slate-800/50 border-r border-white/5 flex flex-col overflow-hidden flex-shrink-0`}
            >
                {/* New Chat button */}
                <div className="p-4">
                    <button
                        onClick={handleNewChat}
                        className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl font-medium hover:from-purple-500 hover:to-blue-500 transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New Chat
                    </button>
                </div>

                {/* Conversation list */}
                <div className="flex-1 overflow-y-auto px-3 space-y-1">
                    {conversations.map((conv) => (
                        <div
                            key={conv.id}
                            className={`group flex items-center gap-2 px-3 py-2.5 rounded-lg cursor-pointer transition-all ${activeConvId === conv.id
                                ? "bg-purple-500/20 border border-purple-500/30"
                                : "hover:bg-white/5"
                                }`}
                            onClick={() => loadConversation(conv.id)}
                        >
                            <span className="text-sm truncate flex-1 text-gray-300">
                                {conv.title || "New Chat"}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteConversation(conv.id);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-all p-1"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    ))}
                </div>

                {/* User info */}
                {user && (
                    <div className="p-4 border-t border-white/5">
                        <div className="flex items-center gap-3 mb-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-sm font-bold">
                                {user.name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{user.name}</p>
                                <p className="text-xs text-gray-500">
                                    {stream} • Year {year}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={logout}
                            className="w-full py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 rounded-lg transition-all"
                        >
                            Sign out
                        </button>
                    </div>
                )}
            </div>

            {/* ─── Main Content ─────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-w-0">
                {/* Top bar */}
                <div className="h-14 flex items-center px-4 border-b border-white/5 gap-3 flex-shrink-0">
                    <button
                        onClick={() => setSidebarOpen(!sidebarOpen)}
                        className="p-2 hover:bg-white/5 rounded-lg transition-all"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                    </button>

                    {/* Year & Stream Selectors */}
                    <div className="flex items-center gap-2 mr-auto">
                        <select
                            value={stream}
                            onChange={(e) => setStream(e.target.value)}
                            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg focus:ring-purple-500 focus:border-purple-500 block p-1.5"
                        >
                            {STREAMS.map((s) => (
                                <option key={s} value={s} className="bg-slate-800">
                                    {s}
                                </option>
                            ))}
                        </select>
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="bg-white/5 border border-white/10 text-white text-sm rounded-lg focus:ring-purple-500 focus:border-purple-500 block p-1.5"
                        >
                            {YEARS.map((y) => (
                                <option key={y.value} value={y.value} className="bg-slate-800">
                                    {y.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Mode selector */}
                    <div className="flex items-center gap-1.5 ml-auto">
                        {MODES.map((m) => (
                            <button
                                key={m.id}
                                onClick={() => setMode(m.id)}
                                title={`${m.name}: ${m.desc}`}
                                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all flex items-center gap-1.5 ${mode === m.id
                                    ? `bg-gradient-to-r ${m.color} text-white shadow-lg`
                                    : "text-gray-400 hover:text-white hover:bg-white/5"
                                    }`}
                            >
                                <span>{m.emoji}</span>
                                <span className="hidden md:inline">{m.name}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* ─── Chat Messages ────────────────────────────────── */}
                <div className="flex-1 overflow-y-auto">
                    {messages.length === 0 ? (
                        // Welcome screen
                        <div className="h-full flex flex-col items-center justify-center px-6">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center mb-6 shadow-lg shadow-purple-500/25">
                                <span className="text-4xl">{currentMode.emoji}</span>
                            </div>
                            <h2 className="text-2xl font-bold mb-2">
                                {currentMode.name} Mode
                            </h2>
                            <p className="text-gray-400 text-center max-w-md mb-2">
                                {currentMode.desc}
                            </p>
                            {user && (
                                <p className="text-gray-500 text-sm">
                                    Answering from{" "}
                                    <span className="text-purple-400 font-medium">
                                        {stream} • Year {year}
                                    </span>{" "}
                                    materials
                                </p>
                            )}

                            {/* Suggestion chips */}
                            <div className="flex flex-wrap justify-center gap-2 mt-8 max-w-lg">
                                {[
                                    "What's my syllabus?",
                                    "Show me the timetable",
                                    "Explain the latest topic",
                                    "Any question papers?",
                                ].map((q) => (
                                    <button
                                        key={q}
                                        onClick={() => {
                                            setInput(q);
                                            inputRef.current?.focus();
                                        }}
                                        className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-sm text-gray-300 hover:bg-white/10 hover:text-white transition-all"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    ) : (
                        // Messages
                        <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
                            {messages.map((msg, i) => (
                                <div
                                    key={i}
                                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"
                                        }`}
                                >
                                    {msg.role === "assistant" && (
                                        <div
                                            className={`w-8 h-8 rounded-lg bg-gradient-to-br ${currentMode.color} flex items-center justify-center flex-shrink-0 mt-1`}
                                        >
                                            <span className="text-sm">{currentMode.emoji}</span>
                                        </div>
                                    )}

                                    <div
                                        className={`max-w-[80%] ${msg.role === "user"
                                            ? "bg-purple-600/30 border border-purple-500/20 rounded-2xl rounded-tr-md px-4 py-3"
                                            : "bg-white/5 border border-white/5 rounded-2xl rounded-tl-md px-4 py-3"
                                            }`}
                                    >
                                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                                            {msg.content}
                                        </p>

                                        {/* Sources */}
                                        {msg.sources && msg.sources.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-white/10">
                                                <p className="text-xs text-gray-500 mb-1.5">📎 Sources:</p>
                                                <div className="space-y-1">
                                                    {msg.sources.map((src, j) => (
                                                        <div key={j} className="text-xs text-gray-400 flex items-center gap-1.5">
                                                            <span>📄</span>
                                                            {src.drive_link ? (
                                                                <a
                                                                    href={src.drive_link}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-purple-400 hover:text-purple-300 underline"
                                                                >
                                                                    {src.filename}
                                                                </a>
                                                            ) : (
                                                                <span>{src.filename}</span>
                                                            )}
                                                            <span className="text-gray-600">({src.type})</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {msg.role === "user" && (
                                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center flex-shrink-0 mt-1">
                                            <span className="text-xs font-bold">
                                                {user?.name.charAt(0).toUpperCase() || "U"}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Loading indicator */}
                            {loading && (
                                <div className="flex gap-3">
                                    <div
                                        className={`w-8 h-8 rounded-lg bg-gradient-to-br ${currentMode.color} flex items-center justify-center flex-shrink-0`}
                                    >
                                        <span className="text-sm">{currentMode.emoji}</span>
                                    </div>
                                    <div className="bg-white/5 border border-white/5 rounded-2xl rounded-tl-md px-4 py-3">
                                        <div className="flex gap-1.5">
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                                            <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div ref={messagesEndRef} />
                        </div>
                    )}
                </div>

                {/* ─── Input Bar ────────────────────────────────────── */}
                <div className="px-4 pb-4 pt-2 flex-shrink-0">
                    <div className="max-w-3xl mx-auto relative">
                        <div className="flex items-end gap-2 bg-white/5 border border-white/10 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-purple-500 focus-within:border-transparent transition-all">
                            <textarea
                                ref={inputRef}
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={`Ask your ${currentMode.name.toLowerCase()} anything...`}
                                rows={1}
                                className="flex-1 bg-transparent text-white placeholder-gray-500 resize-none focus:outline-none px-3 py-2 max-h-32 text-sm"
                                style={{ minHeight: "40px" }}
                            />
                            <button
                                onClick={handleSend}
                                disabled={!input.trim() || loading}
                                className="p-2.5 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
                            >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                                </svg>
                            </button>
                        </div>
                        <p className="text-center text-xs text-gray-600 mt-2">
                            {stream} • Year {year} • {currentMode.name} mode
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
