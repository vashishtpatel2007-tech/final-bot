"use client";

import { useState } from "react";
import Link from "next/link";
import { forgotPassword } from "@/lib/api";

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState("");
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setMessage("");
        setLoading(true);
        try {
            const result = await forgotPassword(email);
            setMessage(result.message);
        } catch (err: any) {
            setError(err.message || "Something went wrong");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
            <div className="absolute top-20 left-20 w-72 h-72 bg-purple-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-20 right-20 w-96 h-96 bg-blue-500/15 rounded-full blur-3xl animate-pulse" />

            <div className="relative z-10 w-full max-w-md mx-4">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-600 mb-4 shadow-lg shadow-purple-500/25">
                        <span className="text-3xl">🔑</span>
                    </div>
                    <h1 className="text-3xl font-bold text-white">Forgot Password</h1>
                    <p className="text-gray-400 mt-2">Enter your email to reset your password</p>
                </div>

                <div className="backdrop-blur-xl bg-white/5 border border-white/10 rounded-2xl p-8 shadow-2xl">
                    {error && (
                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-3 mb-4 text-red-300 text-sm">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg px-4 py-3 mb-4 text-green-300 text-sm">
                            {message}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-gray-300 mb-2">
                                Email Address
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                placeholder="you@bmsit.in"
                                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-xl hover:from-purple-500 hover:to-blue-500 transition-all duration-300 shadow-lg shadow-purple-500/25 disabled:opacity-50"
                        >
                            {loading ? "Sending..." : "Reset Password"}
                        </button>
                    </form>

                    <div className="mt-6 text-center text-gray-400 text-sm">
                        Remember your password?{" "}
                        <Link
                            href="/login"
                            className="text-purple-400 hover:text-purple-300 font-medium transition-colors"
                        >
                            Sign in
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
