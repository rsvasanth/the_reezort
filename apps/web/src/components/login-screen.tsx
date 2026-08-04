import { useState, type FormEvent } from "react";
import { useFrappeAuth } from "frappe-react-sdk";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginScreen() {
	const { login, isLoading } = useFrappeAuth();
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [submitting, setSubmitting] = useState(false);

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!username || !password) {
			toast.error("Enter your email and password.");
			return;
		}

		setSubmitting(true);
		try {
			await login({ username, password });
			// Reload so the auth gate re-reads the now-authenticated session and
			// renders the workspace (avoids a cross-hook revalidation race).
			window.location.reload();
		} catch {
			toast.error("Sign in failed", {
				description: "Check your email and password, then try again.",
			});
			setSubmitting(false);
		}
	}

	const busy = submitting || isLoading;

	return (
		<div className="flex min-h-svh items-center justify-center bg-background px-4">
			<div className="w-full max-w-sm">
				<div className="mb-8 text-center">
					<p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
						THE REEZORT
					</p>
					<h1 className="mt-2 text-2xl font-light text-foreground">Staff Workspace</h1>
				</div>
				<Card>
					<CardHeader>
						<CardTitle className="text-lg font-medium">Sign in</CardTitle>
						<CardDescription>Use your resort staff account to continue.</CardDescription>
					</CardHeader>
					<form onSubmit={onSubmit}>
						<CardContent className="grid gap-4">
							<div className="grid gap-2">
								<Label htmlFor="username">Email</Label>
								<Input
									id="username"
									type="email"
									autoComplete="username"
									placeholder="you@thereezort.com"
									value={username}
									onChange={(event) => setUsername(event.target.value)}
									disabled={busy}
									autoFocus
								/>
							</div>
							<div className="grid gap-2">
								<Label htmlFor="password">Password</Label>
								<Input
									id="password"
									type="password"
									autoComplete="current-password"
									value={password}
									onChange={(event) => setPassword(event.target.value)}
									disabled={busy}
								/>
							</div>
						</CardContent>
						<CardFooter>
							<Button type="submit" className="w-full" disabled={busy}>
								{busy ? (
									<>
										<Loader2 className="mr-2 size-4 animate-spin" />
										Signing in…
									</>
								) : (
									"Sign in"
								)}
							</Button>
						</CardFooter>
					</form>
				</Card>
			</div>
		</div>
	);
}
