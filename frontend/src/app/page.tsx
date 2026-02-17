"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isLoggedIn } from "@/lib/api";

export default function Home() {
    const router = useRouter();

    useEffect(() => {
        if (isLoggedIn()) {
            router.push("/chat");
        } else {
            router.push("/login");
        }
    }, [router]);

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center">
            <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin" />
        </div>
    );
}
