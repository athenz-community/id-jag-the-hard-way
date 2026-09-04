import { signOut } from "@/features/auth/lib/auth"

export async function GET() {
  await signOut({ redirectTo: "/" })
}
