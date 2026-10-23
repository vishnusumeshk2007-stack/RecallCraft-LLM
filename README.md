# RecallCraft 🧠⚡

> An AI-powered adaptive study platform combining **SuperMemo SM-2 spaced repetition**, **LLM-driven Socratic evaluation**, and **semantic vector deduplication** to automate high-yield flashcard generation and active recall.

🌐 **Live Application:** [https://recall-craft-llm.vercel.app](https://recall-craft-llm.vercel.app)  
⚙️ **API Backend:** [https://recallcraft-api.onrender.com](https://recallcraft-api.onrender.com)  
📁 **GitHub Repository:** [https://github.com/vishnusumeshk2007-stack/RecallCraft-LLM](https://github.com/vishnusumeshk2007-stack/RecallCraft-LLM)

---

## 🚀 Core Features

* **Smart Document Ingestion:** Parses unstructured study notes, PDFs, and raw text with automated text extraction and fallback handling.
* **Semantic Deduplication:** Uses local dense vector embeddings (`BAAI/bge-small-en-v1.5` / ONNX runtime) and cosine similarity matching ($\ge 0.82$) to detect and filter out redundant flashcards prior to database insertion.
* **LLM Concept & Card Generation:** Integrates **Groq API** (`openai/gpt-oss-20b`) to extract high-yield concept flashcards, diagnostic multiple-choice questions, and open-ended review prompts in structured JSON format.
* **Socratic Evaluation Engine:** Real-time grading of open-ended user responses against source material rubrics, delivering targeted feedback without revealing solutions directly.
* **SuperMemo SM-2 Spaced Repetition:** Dynamic review interval and ease-factor calculation based on user recall ratings (0–5 scale) for optimized long-term memory retention.
* **Anki Deck Export:** Compiles generated cards directly into downloadable `.apkg` deck bundles compatible with the Anki ecosystem.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | React, Vite, Tailwind CSS, Lucide Icons, Recharts |
| **Backend** | FastAPI, Python 3.11+, SQLAlchemy, SQLite, PyPDF |
| **AI / ML** | Groq API (`openai/gpt-oss-20b`), Dense Vector Hashing Embeddings |
| **Algorithms** | SuperMemo SM-2 Spaced Repetition, Cosine Vector Similarity |
| **Hosting** | Vercel (Frontend CDN), Render (FastAPI Web Service) |

---

## ⚙️ Local Development Setup

### Prerequisites
* **Node.js:** v18+ & `npm`
* **Python:** v3.10+

### 1. Clone Repository
```bash
git clone [https://github.com/vishnusumeshk2007-stack/RecallCraft-LLM.git](https://github.com/vishnusumeshk2007-stack/RecallCraft-LLM.git)
cd RecallCraft-LLM
