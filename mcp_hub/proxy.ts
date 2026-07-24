export { auth as proxy } from "@/features/auth/lib/auth"

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|icons|favicon.ico).*)"],
}
