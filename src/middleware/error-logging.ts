import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Log incoming requests
  console.log(`[${new Date().toISOString()}] ${request.method} ${request.url}`)
  
  // Add error tracking headers
  const response = NextResponse.next()
  response.headers.set('X-Error-Tracking', 'enabled')
  
  return response
}

export const config = {
  matcher: '/api/:path*'
}
