# Goal
Create a professional, production-ready `README.md` file at the root of the repository (`RecallCraft/README.md`) for the GitHub repository.

# Content Structure
Write a comprehensive `README.md` with the following sections:

1. **Title & Tagline**: RecallCraft — AI-Powered Spaced Repetition & Study System.
2. **Key Features**:
   - Material Ingestion (PDF parsing, text extraction, OCR fallback).
   - Semantic Chunking & Deduplication (Local ONNX dense embeddings with cosine similarity matching $\ge 0.82$).
   - SuperMemo SM-2 Algorithm (Dynamic interval scheduling based on recall quality).
   - Socratic Evaluation Engine (LLM-driven grading for open-ended study prompts).
   - Anki Deck Export (Export generated cards directly to `.apkg` files).
3. **Tech Stack**:
   - **Frontend**: React, Vite, Tailwind CSS, Lucide Icons.
   - **Backend**: FastAPI, SQLite / SQLAlchemy, PyPDF.
   - **AI / ML**: Groq API (Llama 3 / Fast Inference), Local Vector Hashing / ONNX Embeddings.
4. **Local Development Setup**:
   - Brief commands for starting the backend (`python -m uvicorn app.main:app --reload --port 8001`).
   - Brief commands for starting the frontend (`npm install`, `npm run dev`).
5. **Deployment Architecture**:
   - Render (FastAPI Backend) + Vercel (React Frontend).
