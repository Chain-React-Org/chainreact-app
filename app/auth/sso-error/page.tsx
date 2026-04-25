"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertTriangle, ArrowLeft, Mail } from "lucide-react"
import Link from "next/link"

function SSOErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get("error") || "An unknown error occurred"

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <Card className="max-w-md w-full">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle className="text-xl">SSO Authentication Failed</CardTitle>
          <CardDescription className="text-red-600 dark:text-red-400">
            {error}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-gray-600 dark:text-gray-200 text-center">
            <p>This could happen if:</p>
            <ul className="mt-2 text-left list-disc list-inside space-y-1">
              <li>Your SSO session expired</li>
              <li>Your organization's SSO is misconfigured</li>
              <li>Your account doesn't exist in this organization</li>
              <li>Your email domain is not authorized</li>
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <Button asChild variant="default" className="w-full">
              <Link href="/auth/login">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Login
              </Link>
            </Button>
            <Button asChild variant="outline" className="w-full">
              <Link href="/support">
                <Mail className="w-4 h-4 mr-2" />
                Contact Support
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function SSOErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-gray-600 dark:text-gray-200">Loading...</div>
      </div>
    }>
      <SSOErrorContent />
    </Suspense>
  )
}
