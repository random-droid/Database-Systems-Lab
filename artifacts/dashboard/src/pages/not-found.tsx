import { Link } from "wouter";
import { Terminal } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function NotFound() {
  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background text-foreground font-mono">
      <Card className="max-w-md w-full border-border bg-card shadow-lg mx-4">
        <CardContent className="p-8">
          <div className="flex items-center gap-3 mb-6">
            <Terminal className="w-6 h-6 text-destructive" />
            <h1 className="text-xl font-bold text-destructive uppercase tracking-widest">404: Signal Lost</h1>
          </div>
          <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
            The requested coordinate could not be found in the system matrix. 
            Please verify your parameters and recalibrate.
          </p>
          <Link href="/" className="inline-flex items-center justify-center rounded-sm text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-4 py-2 w-full uppercase tracking-wider">
            Return to Console
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
