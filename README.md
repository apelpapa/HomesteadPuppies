# Homestead Puppies

A full-stack web application built to manage a small breeding business end-to-end.

This project began as a simple static website and evolved into a production application with authentication, database-backed content management, and cloud-based media storage.

---

## Overview

Homestead Puppies is a Node.js + Express application that provides:

- Public-facing website for viewing available puppies
- Admin authentication
- Full CRUD management for:
  - Puppies
  - Breeds
  - Parents
- Image uploads stored in AWS S3
- PostgreSQL-backed data persistence
- Server-side rendering with EJS
- Reverse-proxied production deployment (Nginx → Node)

This application ran in production and supported real users.

---

## Tech Stack

### Backend
- Node.js
- Express
- PostgreSQL (`pg`)
- Passport (Local Strategy)
- bcrypt
- express-session

### Templating
- EJS

### File Uploads
- Multer
- Multer-S3
- AWS S3

### Deployment
- Nginx reverse proxy
- SSL via Cloudflare origin certificates
- Linux VPS hosting

---

## Key Features

### Authentication
Admin panel protected using Passport Local strategy and session-based authentication.

### Content Management
Custom-built admin interface allowing non-technical users to:
- Add/edit/remove puppies
- Upload multiple images per puppy
- Manage breed and parent records

### Media Handling
Images are uploaded directly to AWS S3 and referenced in the PostgreSQL database.

### Production Architecture

Requests flow through:

Cloudflare → Nginx → Node → Express → PostgreSQL / AWS S3

Upload size limits and reverse proxy configuration are handled at both the multer and Nginx layer.

---

## What This Project Demonstrates

- Building a real-world CRUD system
- Authentication and session management
- File upload handling in production
- Integration with external cloud services (S3)
- Reverse proxy configuration and debugging
- Managing environment variables and deployment concerns

---

## Status

This project was used in production and later retired. It remains as a representative full-stack application demonstrating backend architecture, authentication, file handling, and deployment.
