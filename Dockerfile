# ==========================================
# STAGE 1: Build the React Frontend
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app

# Copy package files from the frontend folder and install dependencies
COPY wow-dashboard/package*.json ./
RUN npm install

# Copy all frontend source files and build
COPY wow-dashboard/ ./
RUN npm run build
# The compiled frontend is now located in /app/dist

# ==========================================
# STAGE 2: Setup the Python Backend
# ==========================================
FROM python:3.11-slim
WORKDIR /app

# Install system dependencies required by WeasyPrint (PDF generation)
# Note: Debian Bookworm requires the hyphen in libgdk-pixbuf-2.0-0
RUN apt-get update && apt-get install -y \
    build-essential \
    python3-dev \
    python3-pip \
    python3-cffi \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libffi-dev \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies (from the root folder)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy FastAPI backend code from the backend folder
COPY big-picture-api/main.py .
COPY big-picture-api/template.html .
COPY big-picture-api/scripts ./scripts

# Copy the compiled React UI from Stage 1 into the Python container
COPY --from=frontend-builder /app/dist ./dist

# Copy the admin/developer help docs (served in-app via the ⓘ button on
# every view, GET /api/help/{slug} in main.py) into the same ./docs folder
# main.py looks for them in — README.md and ARCHITECTURE.md land alongside
# docs/*.md so DOCS_DIR only ever has to look in one place.
COPY docs ./docs
COPY README.md ARCHITECTURE.md ./docs/

# Expose the single port that FastAPI will run on
EXPOSE 8000

# Start the FastAPI server
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]