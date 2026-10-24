"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound } from "lucide-react";

const ERRORS: Record<string, string> = {
  invalid: "That token doesn't match the bridge's current token.",
  "no-token": "The frontend can't find the bridge token. Start the bridge first, or set BRIDGE_TOKEN for the frontend.",
};

function LoginForm() {
  const error = useSearchParams().get("error");
  return (
    <Card className="max-w-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Sign in
        </CardTitle>
        <CardDescription>
          The app talks to the PowerShell bridge on your behalf, so it needs the bridge token once per browser.
          <code className="mx-1">Start-DNSPolicyManager.ps1</code>
          opens a link that signs you in automatically.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A plain form post: the token goes straight to /auth and is never kept in page state. */}
        <form method="post" action="/auth" className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token">Bridge token</Label>
            <Input id="token" name="token" type="password" autoComplete="off" required autoFocus />
            <p className="text-xs text-muted-foreground">
              On the bridge machine it is in <code>%LOCALAPPDATA%\DNSPolicyManager\bridge.token</code>. For Docker, it is
              the <code>BRIDGE_TOKEN</code> value in your <code>.env</code>.
            </p>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert" data-testid="login-error">
              {ERRORS[error] ?? "Sign-in failed."}
            </p>
          )}
          <Button type="submit">Sign in</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <div className="space-y-6 p-6">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
