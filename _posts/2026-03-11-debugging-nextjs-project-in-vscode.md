---
layout: post
title: "Debugging Next.js Project in VS Code"
tags: [nextjs, vscode, debugging, development]
categories: [programming]
description: "A comprehensive guide on debugging Next.js projects using Visual Studio Code with practical tips and best practices."
author: vimm0
date: 2026-03-11 17:30:00 -0500
image: /images/2026-03-11-debugging-nextjs-in-vscode.jpg
---

## Introduction

Debugging is an essential part of software development, and Visual Studio Code with its excellent debugging features is the go-to choice for many Next.js developers. In this post, we'll explore various ways to debug your Next.js projects in VS Code effectively.

## Prerequisites

Before diving into debugging, ensure you have:

1. VS Code installed
2. Recommended extensions (see below)
3. Node.js installed (v18 or higher recommended for Next.js 13+)
4. The Next.js project should be created and running locally

## Essential VS Code Extensions for Next.js Debugging

### Must-Have Extensions

| Extension | Purpose |
|-----------|---------|
| **Prettier - Code formatter** | Consistent code formatting |
| **ESLint** | Linting to catch issues early |
| **Vitest / Jest by VueVS** | Testing framework integration |
| **Thunder Client** | API testing for backend routes |
| **Path Intellisense** | Better IntelliSense for file paths |
| **Docker** (optional) | For container-based debugging |
| **OpenSSL Utility** | Self-signed certificates support |

## Setup Your Environment

### 1. Configure VS Code Settings

Create a `.vscode/settings.json` in your project root:

```json
{
  "editor.formatOnSave": true,
  "[javascript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "eslint.packageManager": "npm",
  "typescript.tsdk": "node_modules/typescript/lib"
}
```

### 2. Create a Debug Configuration

VS Code allows you to run multiple debug configurations. Create a `.vscode/launch.json` file:

```json
{
  // Use IntelliSense to learn about possible attributes.
  // Use Ctrl+Shift+P (Windows/Linux) or Cmd+Shift+P (macOS) to open the Command Palette.
  // Type 'Debug Configuration' to start configuring a launcher.
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: DEBUG PORT",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${workspaceFolder:.development/node_modules/.bin/node}",
      "windowsRuntimeExecutable": "${workspaceFolder:.development/node_modules/.bin/npm_exec_bin.cmd}",
      "runtimeArgs": [
        "--inspect=9229",
        "--nolazy"
      ],
      "env": {
        "NODE_OPTIONS": "--inspect-brk=9229"
      },
      "skipFiles": [
        "<node_internals>/**"
      ],
      "preLaunchTask": "Next: dev",
      "serverReadyAction": {
        "action": "openExternally",
        "pattern": "^localhost(:\\d+)?/"
      }
    },
    {
      "name": "Next.js: Debug with NODE_OPTIONS",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "env": {
        "NODE_OPTIONS": "--inspect-brk=9229"
      },
      "port": 9229,
      "serverReadyAction": {
        "action": "openExternally",
        "pattern": "\\bin\\.\\d{3}"
      },
      "internalConsoleOptions": "openOnSessionStart"
    },
    {
      "name": "Next.js: Node Debug (App Router)",
      "type": "node",
      "request": "launch",
      "cwd": "${workspaceFolder}",
      "runtimeExecutable": "${execPath}",
      "program": "${workspaceFolder}",
      "env": {
        "NODE_OPTIONS": "--inspect-brk=9229"
      },
      "serverReadyAction": {
        "action": "openExternally",
        "pattern": "/\\d{3}"
      },
      "sourceMap": true,
      "outFiles": [
        "${workspaceFolder}/node_modules/.next/**/dist/server/**/*.js"
      ]
    }
  ]
}
```

## Debugging Strategies

### Method 1: Inline Breakpoints (Easiest)

1. Click on the line number margin to add a breakpoint
2. Press `F5` or use the Command Palette → "Debug and restart"
3. The debugger will pause at your breakpoint
4. Use the debug panel to step through code (`F11` to step into, `F10` to step over)

```javascript
// Example with inline breakpoint
function calculateTotal(items) { // ← Click here for breakpoint
  let total = 0;
  
  items.forEach(item => { // ← or here
    total += item.price * item.quantity;
  });
  
  // ← Breakpoint here to inspect total after calculation
  return total; 
}
```

### Method 2: Debug Server with `NODE_OPTIONS`

For Next.js, you can enable debugging by setting the environment variable:

**Using package.json scripts:**

```json
{
  "scripts": {
    "dev": "next dev",
    "dev:debug": "NODE_OPTIONS='--inspect=9229' next dev"
  }
}
```

Then select your debug configuration and start debugging. The VS Code debugger will attach when Next.js is running with the `--inspect` flag.

### Method 3: Using Chrome DevTools Integration

VS Code can launch a Node process with Chrome DevTools integration:

1. Set breakpoints in your code
2. Press `F5` to start debugging
3. Right-click on the browser element you want to inspect → "Inspect Element"
4. The debugger will show the corresponding source code

### Method 4: Debug API Routes (Pages Router)

For older Pages Router setups or middleware, use these breakpoints:

```javascript
// pages/api/hello.js
export default async function handler(req, res) {
  // Breakpoint here to inspect req object
  console.log('Incoming request:', req);
  
  try {
    const data = await fetch('https://example.com/data');
    
    // Breakpoint after fetching
    const response = await data.json();
    
    res.status(200).json(response);
  } catch (error) {
    // Breakpoint for error handling
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

## Common Debugging Scenarios

### Scenario 1: Inspecting State in getServerSideProps

With Next.js App Router, debug your data fetching:

```tsx
// app/users/page.tsx
export async function generateMetadata() {
  // ← Set breakpoint here to verify metadata generation
  
  return {
    title: 'Users Page'
  };
}

export const dynamic = 'force-dynamic';

export default async function UsersPage({ params }) {
  // ← Breakpoint: inspect params object
  
  const users = await fetch(`/api/users/${params.userId}`, {
    next: { revalidate: 0 }
  }).then(res => res.json());
  
  // ← Breakpoint after API call
  
  return (
    <div>
      <h1>{users.name}</h1>
    </div>
  );
}
```

### Scenario 2: Debugging Middleware Issues

Middleware is a common pain point. Here's how to debug it:

```javascript
// middleware.js
export function middleware(request) {
  // ← Breakpoint: inspect request object
  
  const token = request.cookies.get('auth_token')?.value;
  
  if (!token) {
    // ← Log before redirect
    console.log('Unauthorized access');
    
    return NextResponse.redirect('/login');
  }
  
  // ← Breakpoint: verify middleware execution path
}
```

### Scenario 3: Debugging React Server Components

RSC debugging requires special attention since they're not transpiled like client components:

```tsx
// app/dashboard/page.tsx (Server Component by default)
export default async function Dashboard() {
  // ← Server-side execution, can set breakpoint
  
  const data = await fetch('https://api.example.com/data');
  
  return (
    <main>
      {/* Client component - breakpoints work normally */}
      <ClientComponent />
    </main>
  );
}

// app/dashboard/client-component.tsx (Client Component)
'use client';

export default function ClientComponent() {
  const [count, setCount] = useState(0);
  
  return (
    <button onClick={() => setCount(c => c + 1)}>
      Clicks: {count}
    </button>
  );
}
```

### Scenario 4: Debugging Third-Party SDKs

When debugging third-party libraries like Supabase, Prisma, or TailwindCSS:

```typescript
// lib/supabase.ts
export const createClient = () => {
  supabaseUrl = 'YOUR_SUPABASE_URL';
  supabaseKey = 'YOUR_SUPABASE_ANON_KEY';
  
  return supabase.createClient(supabaseUrl, supabaseKey);
};
```

Create a breakpoint before importing the function to inspect environment variables:

```typescript
const client = createClient(); // ← Breakpoint after initialization
```

## Debugging Visual Studio Code Shortcuts

| Action | Shortcut (macOS) | Shortcut (Windows/Linux) |
|--------|------------------|--------------------------|
| Start/Stop Debug | `F5` or `Ctrl + Shift + F5` | `Cmd + Shift + Y` |
| Add Toggle Breakpoint | `F9` or `Ctrl + K, Ctrl + B` | `Ctrl + F9` or `Ctrl + Shift + B` |
| Step Into | `F11` | `-` (minus key) |
| Step Over | `F10` | `_` (underscore) |
| Step Out | `Shift + F11` | `~` (tilde) |
| Continue Execution | `F5` | - |
| Clear Breakpoints | `Ctrl + Shift + K, Ctrl + B` | - |

## Debugging Best Practices

### 1. Use Watch Expressions

Add expressions to the watch panel to monitor their values in real-time:

- Click the **+** button in the debug sidebar
- Add variables you want to track (e.g., `req.payload` or `state.data`)

### 2. Conditional Breakpoints

Use conditional breakpoints for complex scenarios:

```javascript
// Example: break only when error occurs
function handleError(error) {
  console.error('Error:', error); // Click line, then:
  // Command Palette → "Add condition to breakpoint in active file"
  // Condition: `error.code === 'ECONNREFUSED'`
}
```

### 3. Use Console Logging Effectively

Before setting a breakpoint, use logging to understand the flow:

```javascript
const data = await fetchData(); // ← Log before function call
console.log('Data received:', { type: typeof data, length: data.length });
```

But remember, logging adds noise — breakpoints are cleaner for complex debugging.

### 4. Debug Network Requests

Right-click on the network response in the browser DevTools → "Show Request Headers" to inspect headers and cookies.

For API routes, use Thunder Client extension to test endpoints with mock data.

## Common Pitfalls and Solutions

### Pitfall 1: App Router vs Pages Router Differences

The App Router uses the Edge runtime by default, which doesn't support traditional Node.js breakpoints in server-side code. For debugging App Router Server Components:

- Use Chrome DevTools instead (requires proper setup)
- For middleware functions: they execute in Node.js and debug normally
- For API routes: standard breakpoints work

### Pitfall 2: TypeScript Errors

If you see "No source maps" errors, ensure your build process generates them or use `// @ts-check` for JavaScript files.

To fix the issue when the debugger doesn't attach properly:

1. In `.vscode/launch.json`, add:
```json
"sourceMaps": true,
"preLaunchTask": "next:dev",
```

2. In your `package.json`:
```json
{
  "scripts": {
    "dev": "next dev --no-depcheck",
    "dev-debug": "NODE_OPTIONS='--inspect=9229' next dev"
  }
}
```

### Pitfall 3: Environment Variables Not Available

In the `.env.local` file, all variables are available on `process.env`, but in Server Components they're compiled inline. You must use `'use server'` for accessing environment variables in client-side components.

## Next Steps

- Learn about **Source Maps** to enable better debugging with transpiled code
- Understand how different runtimes (Node.js, Bun, Deno) affect debugging
- Explore **Playwright testing** integration with VS Code for end-to-end debugging

## Conclusion

Debugging Next.js projects in VS Code offers a robust and flexible environment for troubleshooting issues. By following this guide's strategies and avoiding common pitfalls, you'll be able to debug your applications effectively using breakpoints, watch expressions, and more advanced features.

Remember: **Break early, break often**, and use logging strategically to minimize development time while accelerating bug resolution.
