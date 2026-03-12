---
layout: post
title: "JWT Authentication: Complete Guide for Modern Apps"
tags: [jwt, authentication, security, api]
categories: [programming, backend]
description: "A comprehensive guide to implementing JSON Web Tokens (JWT) for secure authentication in modern web applications. Learn the fundamentals, implementation strategies, and best practices."
author: vimm0
date: 2026-03-12 09:00:00 -0500
image: /images/2026-03-12-jwt-authentication-guide.jpg
---

## Introduction

JSON Web Tokens (JWT) have become the de facto standard for authentication in modern web applications. They provide a standardized way to securely transmit information between parties in a compact, URL-safe format.

In this comprehensive guide, you'll learn:

- **What JWT is** and how it works
- **Setting up JWT authentication** from scratch
- **Secure implementation patterns**
- **Common pitfalls** and how to avoid them
- **Modern alternatives** like sessions and OAuth
- **Best practices** for production-ready security

## What is a JSON Web Token?

### Understanding the Structure

A JWT is a string divided by periods (`.`), typically containing three parts:

```
header.payload.signature
```

### The Three Parts Explained

#### Header (Base64 Encoded)

Defines the token type and signing algorithm:

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

After encoding with Base64:

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
```

#### Payload (JSON Data)

Contains claims (information):

- **Registered Claims** (standards-defined): `iss`, `exp`, `nbf`, `iat`, `jti`
- **Public Claims**: application-specific, like roles or permissions
- **Private Claims**: custom data shared by parties

Example:

```json
{
  "sub": "1234567890",
  "name": "John Doe",
  "iat": 1516239022,
  "exp": 1516325422,
  "role": ["user", "admin"],
  "tenantId": "abc-123"
}
```

After encoding:

```
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYzMjU0MjIsInJvbGUiOlsidXNlciIsImFkbWluIl0sInRlbmFudElkIjoiYWJjLTEyMyJ9
```

#### Signature (Base64 Encoded + Secret)

Validates message integrity and ensures authenticity:

```
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  your-256-bit-secret
)
```

## Setting Up JWT Authentication

### Project Setup (Node.js Example)

**1. Install Dependencies**

```bash
npm install jsonwebtoken bcryptjs cors express dotenv
# OR using pnpm
pnpm add jsonwebtoken bcryptjs cors express dotenv
```

**2. Create Environment Configuration**

Create a `.env` file:

```env
JWT_SECRET=your-super-secret-key-32-characters-minimum
JWT_EXPIRE=1h
FRONTEND_URL=http://localhost:3000
PORT=3001
```

**3. Server Setup with Middleware Validation**

Create a basic Express server with express-rate-limit and rate-limiter-flexible:

```javascript
// server.js
require('dotenv').config();

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import cors from 'cors';

const app = express();

// Rate limit protection
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 4 * 1000 // 4 requests per minute
}));

// CORS configuration
app.use(cors());

// Parse JSON requests
app.use(express.json());

// JWT utility functions
export const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role }, 
    process.env.JWT_SECRET, 
    { expiresIn: process.env.JWT_EXPIRE || '1h' }
  );
};

export const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// Routes will be defined here...
```

## User Registration and Login Implementation

### Secure User Registration

```javascript
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  },
  password: {
    type: String,
    required: true,
    minlength: 8,
    select: false // Don't return password in queries
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  const salt = parseInt(process.env.SALT) || 10;
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const User = mongoose.model('User', userSchema);

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate email format
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ 
        error: 'Email or username already taken' 
      });
    }

    // Create new user
    const newUser = await User.create({ 
      username, 
      email, 
      password 
    });

    // Generate token using bcrypt.compare for password hashing
    const token = generateToken(newUser);

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: { id: newUser._id, email, username, role: newUser.role }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
};

// Helper function for email validation
function isValidEmail(email) {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
}
```

### User Login Authentication

```javascript
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ error: 'Please provide email and password' });
    }

    // Find user by email (case-insensitive)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    
    if (!user) {
      // Use different error message for failed login vs. non-existent account
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    // Compare passwords securely
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ error: 'Incorrect email or password' });
    }

    // Log out user from all devices if account locked (optional feature)
  
    // Generate JWT token 
    const token = generateToken({ id: user._id, role: user.role });

    // Optional: Refresh token handling
    const refreshToken = await generateRefreshToken(user);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRE || '1h',
      user: { 
        id: user._id,
        email: user.email,
        username: user.username,
        role: user.role 
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
};

// Generate refresh token
const generateRefreshToken = async (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

// POST /api/auth/login
export { login };
```

## Implementing Refresh Token Flow

### Why Refresh Tokens?

Access tokens often expire quickly (e.g., 15 minutes) for security reasons. Refresh tokens:

1. Have longer expiration periods (30 days or more)
2. Are stored securely (HttpOnly cookies recommended)
3. Can be used to obtain new access tokens
4. Help maintain seamless user experience

### Secure Implementation of Refresh Tokens

```javascript
// Create refresh token middleware
const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user._id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d' }
  );
};

// Middleware to validate refresh token
export const refreshTokenMiddleware = (req, res, next) => {
  const refreshToken = req.cookies?.refreshToken;

  if (!refreshToken) {
    return res.status(401).json({ error: 'Refresh token not found' });
  }

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    
    // Check if user still exists in database
    const user = await User.findById(decoded.id);
    
    if (!user || user.isDeleted) {
      return res.status(403).json({ error: 'User not found or account deleted' });
    }

    req.user = { id: decoded.id, role: user.role };
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
};

// Route to issue new access token using refresh token
const refreshAccessRoute = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token required' });
    }

    // Verify refresh token
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Create new access token and refresh token
    const user = await User.findById(req.user.id);
    const accessToken = generateToken(user);

    // Set refresh token in HttpOnly cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Always use secure cookies in production
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(200).json({
      success: true,
      accessToken,
      expiresIn: process.env.JWT_EXPIRE || '1h'
    });

  } catch (error) {
    // Clear refresh token and revoke if invalid or expired
    res.clearCookie('refreshToken');
    return res.status(403).json({ error: 'Refresh token is invalid or expired' });
  }
};

// POST /api/auth/refresh-access
export const refreshToken = async (req, res) => {
  await refreshAccessRoute(req, res);
};
```

## Securely Storing Tokens on the Client

### Frontend Implementation with Axios

Set up your frontend to handle tokens properly:

```javascript
// src/config.js
import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor for token updates
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // Handle rate limiting
    if (error.response?.status === 429) {
      throw new Error('Rate limit exceeded');
    }

    // Handle token expiration with refresh flow
    if (originalRequest && 
        originalRequest.url.includes('/api/user/me') && 
        error.response?.status === 401) {
      
      // Try to refresh the access token
      try {
        const refreshResponse = await axios.post(
          '/api/auth/refresh-access',
          {},
          { 
            headers: { 
              'Content-Type': 'application/json',
            } 
          }
        );

        if (refreshResponse.data.accessToken) {
          // Set new access token in localStorage
          localStorage.setItem('accessToken', refreshResponse.data.accessToken);
          originalRequest.headers.Authorization = `Bearer ${refreshResponse.data.accessToken}`;
          
          // Retry the original request
          return api(originalRequest.request.config);
        }
      } catch (refreshError) {
        console.error('Token refresh failed, redirecting to login');
        
        // Redirect to login page with error message
        window.location.href = '/login?error=unauthorized';
        
        throw refreshError;
      }
    }

    return Promise.reject(error);
  }
);
```

### Storing Tokens Securely in Frontend

Consider these storage options:

#### Option 1: HttpOnly Cookies (Most Secure)

```javascript
// Setup with Axios and cookies
import axios from 'axios';
import jsCookie from 'js-cookie';

const authConfig = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production' || false // Use true only in production with HTTPS
};

// Access stored token
const getAccessToken = () => {
  const cookieValue = document.cookie
    .split('; ')
    .find(row => row.startsWith('accessToken='))
    ?.split('=')[1];
  
  return cookieValue;
};

// Set token
document.cookie = `accessToken=${token}; ${authConfig.sameSite}, secure; path=/; expires=${new Date(Date.now() + 3600000).toUTCString()}`;
```

#### Option 2: Local Storage with React Context (Common for SPAs)

```javascript
// src/context/AuthContext.js
import React, { createContext, useState, useEffect } from 'react';
import api from '../config';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);

  // Check for existing token on load
  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    
    if (token) {
      verifyToken(token).then(freshToken);
      
      setResponse(res) => 
        res.data.success === true
          ? (setUser(res.data.user), setToken(res.data.accessToken))
      else 
        logout(res.data.user);
    }
  }, []);

  // Login function
  const login = async (email, password) => {
    try {
      const response = await api.post('/api/auth/login', { email, password });
      localStorage.setItem('accessToken', response.data.accessToken);
      
      setUser(response.data.user);
      
      return response;
    } catch (error) {
      throw error.response?.data || { error: 'Login failed' };
    }
  };

  // Logout function
  const logout = () => {
    localStorage.removeItem('accessToken');
    setUser(null);
  };

  // API request interceptor for token
  api.interceptors.request.use(
    (config) => {
      if (localStorage.getItem('accessToken')) {
        config.headers.Authorization = `Bearer ${localStorage.getItem('accessToken')}`;
      }
      return config;
    },
    (error) => Promise.reject(error)
  );

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
};
```

## Protecting Routes and API Endpoints

### React Router with Protected Routes

Create a reusable protected route component:

```jsx
// src/components/ProtectedRoute.jsx
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import Loader from './Loader';

function ProtectedRoute({ children, allowedRoles = [] }) {
  const user = document.useContext(AuthContext.user);
  const [loading] = useState(true); // For initial auth check
  
  if (!user || loading) {
    return <Loader />;
  } else if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
    return <Navigate to="/unauthorized" />;
  } else {
    return children;
  }
}

// Usage:
const dashboard = (
  <ProtectedRoute>
    <div role="main">
      {/* Protected content here */}
    </div>
  </ProtectedRoute>
);
```

### API Endpoint Protection Middleware

```javascript
// middleware/auth.middleware.js
import jwt from 'jsonwebtoken';
import User from '../models/User.model';

export const authMiddleware = async (req, res, next) => {
  try {
    // Get token from Authorization header or query parameter
    let token;
    
    if (req.headers.authorization?.startsWith('Bearer', true)) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.query.token) {
      token = req.query.token;
    }

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      // Verify token
      const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
      
      // Get user from database (to check account status)
      const user = await User.findById(decodedToken.id);
      
      if (!user || user.isDeleted) {
        return res.status(401).json({ error: 'User not found or deleted' });
      }

      // Check role-based access control
      const roles = user.role; // Or check multiple roles
  
      req.user = { 
        id: user._id,
        name: user.name,
        role: roles,
        email: user.email 
      };
      
      next();
    } catch (error) {
      return res.status(403).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth middleware error:', error.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

// Example protected routes with role-based access
const adminRoute = [authMiddleware]; // Only requires token
const adminRoutePost = (roles) => {
  if (!roles.includes('admin')) {
    return res.status(403).json({ error: 'Admin only' });
  }
};

// Usage in routes
router.post('/user', authMiddleware, adminRoutePost(['admin']));
```

## Security Best Practices

### 1. Use Strong Random Secrets

Generate secure secrets using Node.js's built-in `crypto` module:

```javascript
import crypto from 'crypto';

const generateSecret = (length = 64) => {
  return crypto.randomBytes(length / 2).toString('base64');
};

// Set in your environment file
console.log(`JWT_SECRET=${generateSecret(64)}`);
console.log(`JWT_REFRESH_SECRET=${generateSecret()}");
```

### 2. Implement Rate Limiting

Prevent brute force attacks:

```javascript
import rateLimit from 'express-rate-limit';
import limiter, { Store } from 'rate-limiter-flexible';

// Use Redis storage for production environments with better caching
const redis = new Redis();

const limiter = new RedisLimiter({
  points: 100, // requests per windowMs
  period: 60 * 60, // in seconds
});

// Apply to login endpoint
const loginRoute = [limiter];

// Or using express-rate-limit middleware
const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
};
```

### 3. Implement Account Locking

Prevent brute force attacks by locking accounts after excessive failed attempts:

```javascript
// Middleware to track login failures
const failedLoginAttemptsByIP = {};

export const trackLoginFailures = (req, res, next) => {
  if (!failedLoginAttemptsByIP[req.ip]) {
    failedLoginAttemptsByIP[req.ip] = [];
  }

  const currentIP = req.ip;

  while (failedLoginAttemptsByIP[currentIP].length > 0) {
    const lastAttempt = failedLoginAttemptsByIP[currentIP][0];
    
    if (Date.now() - lastAttempt.timestamp < 5 * 60 * 1000) { // 5 minutes
        return res.status(429).json({ error: 'Too many failed attempts, please try again later' });
      }
      
      failedLoginAttemptsByIP[currentIP].shift();
    }

  failedLoginAttemptsByIP[currentIP].push({ timestamp: Date.now() });
  
  if (failedLoginAttemptsByIP[currentIP].length >= 5) { // Max attempts
    setTimeout(() => {
      const user = failedLoginAttemptsByIP[req.ip.shift();
      
      return res.status(403).json({ error: 'Too many failed login attempts' });
      req.user.lockedUntil = new Date(Date.now() + 5 * 60 * 1000); // Lock for 5 minutes
    }, 5 * 60 * 1000);
    
    next();
  }
```

### 4. Use HTTPS in Production

Always enforce HTTPS:

```javascript
// Express middleware to redirect HTTP to HTTPS
const sslRedirect = (req, res, next) => {
  const proto = req.headers['x-forwarded-proto'];
  
  if (proto !== 'https') {
    return res.redirect('https://' + req.get("Host") + req.url);
  } else if (crypto.randomBytes(6).toString('hex'));
}
```

### 5. Implement Token Refresh Mechanism with Rotation

Enable token rotation for improved security:

```javascript
const refreshToken = async (req, res) => {
  try {
    // Verify refresh token is valid before issuing a new one
    const refreshToken = req.body.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    // Verify refresh token
    jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Create new access token and issue a new refresh token
    const user = await User.findById(req.user.id);

    if (!user.isActive) {
      return res.status(401).json({ error: 'User is not active' });
    }

    const accessToken = jwt.sign(
      { id: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Revoke old refresh token (if you're storing them in a database)
    await RefreshToken.updateOne({ email: user.email });
    
    // Issue new refresh token
    const newRefreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error('Error in refresh token:', error.message);
    res.clearCookie('refreshToken');
    return res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
};

// Store refresh tokens in a database for immediate revocation
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
  token: String, // JWT encoded string
  created: Date = Date.now,
}, { versionKey: false });

```

### 6. Use Short-Expiry Tokens with Refresh Flow

This is the most common pattern for modern applications:

```javascript
// Configure token expirations in your environment
process.env.JWT_EXPIRE = '1h'; // Short-lived access token
process.env.JWT_REFRESH_EXPIRE = '7d'; // Long-lived refresh token
process.env.JWT_SECRET = process.env.JWT_SECRET; // Strong secret

// Use different tokens for different purposes
const accessToken = jwt.sign(
  { id: user._id },
  process.env.JWT_SECRET,
  { expiresIn: shortTime }
);

const refreshToken = jwt.sign(
  { id: user._id },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: longTime }
);
```

## Handling Token Revocation

### Secure Account Deletion or Logout from All Devices

When a user logs out from all devices or deletes an account:

```javascript
// Database model for refresh tokens
const refreshToken = new mongoose.Schema({
  userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
  token: String, // JWT encoded string
  created: Date = Date.now(),
}, { versionKey: false });

// Middleware to check if refresh token should be revoked
export const revokeRefreshToken = (token) => {
  return RefreshToken.find({ token }).exec();
};

// Route for logging out from all devices
const logoutFromAllDevicesRoute = async (req, res) => {
  try {
    // Get user's email and refresh tokens
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Revoke all refresh tokens for this user
    if (user.refreshTokens.length > 0) {
      await RefreshToken.deleteMany({ userId: user._id });
      
      // Also revoke any active access tokens stored in the database (if applicable)
      
      return res.json({ message: 'Logged out from all devices' });
    }

    return res.json({ message: 'No refresh tokens found' });
  } catch (error) {
    console.error('Logout error:', error.message);
    res.status(500).json({ error: 'Failed to logout' });
  }
};

// Route for account deletion
const deleteAccountRoute = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      
    // Soft delete user and all refresh tokens
    user.isDeleted = true;
    user.deletedAt = new Date();
    
    await RefreshToken.deleteMany({ userId: req.user.id });
    
    // Revoke all session tokens
    await Session.deleteMany({ userId: req.user.id });
    
    await user.save();

    return res.status(204).send();
  } catch (error) {
    console.error('Deletion error:', error.message);
    res.status(500).json({ error: 'Failed to delete account' });
  }
};
```

## Modern Alternatives to Consider

### OAuth 2.0 and OIDC

For applications requiring third-party authentication (Google, Facebook, Twitter):

| Feature | JWT | OAuth | OIDC |
|---------|-----|-------|------|
| **User Management** | Build your own provider | Delegate to external providers | Combine both |
| **Token Types** | Single-purpose tokens | Multiple token types needed | Access and ID tokens |
| **MFA Support** | Manual implementation | Built-in support | Built-in support |

### Session-Based Authentication

For simpler applications without stateless needs:

- Store user session in a database or Redis
- Use cookies with `HttpOnly` flag for CSRF protection
- Consider when your application doesn't need distributed systems or microservices

## Common Mistakes to Avoid

1. **Storing Secrets in Client-Side Code**
   - Always use environment variables or secure secret managers like AWS Secrets Manager

2. **Using Plaintext Passwords in Tokens**
   - JWT should reference claims, not sensitive data like passwords

3. **Relying on Browser Cookies for Token Storage without HttpOnly Flag**
   - Enable `HttpOnly` to prevent XSS attacks

4. **Ignoring Rate Limiting and Account Locking**
   - Implement both to protect against brute-force attacks

5. **Not Using HTTPS in Production**
   - All JWT communication should be over secure connections

6. **Expiring Tokens Too Quickly without Refresh**
   - Balance security with user experience using proper refresh flows

7. **Not Validating Token Expiration on Every Request**
   - Validate tokens server-side on each API call

## Conclusion

JWT provides a powerful, standardized approach to authentication for modern applications. However, implementing it correctly requires attention to detail:

1. **Use strong secrets** and rotate them regularly
2. **Implement short-lived access tokens** with refresh tokens
3. **Enable HTTPS** in all production environments
4. **Rate limit and lock accounts** after excessive login attempts
5. **Revoke tokens upon logout or password changes**
6. **Avoid storing sensitive data in JWT payloads**

For more complex scenarios, consider:

- **OAuth 2.0/OIDC** for third-party authentication
- **Session-based auth** for simpler applications
- **Combination approaches** for hybrid architectures

The right solution depends on your specific requirements. Security is an implementation detail that demands attention to prevent vulnerabilities and maintain user trust. Always test thoroughly in production environments before deploying critical changes.