#!/usr/bin/env python3
"""
Streamlit Chat App for Nordstemmen Qdrant + Anthropic
"""

import streamlit as st
from sentence_transformers import SentenceTransformer
from qdrant_client import QdrantClient
from anthropic import Anthropic
import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Page config
st.set_page_config(
    page_title="Nordstemmen Chat",
    page_icon="💬",
    layout="wide"
)

# Sidebar for configuration
with st.sidebar:
    st.title("⚙️ Konfiguration")

    st.subheader("Qdrant")
    qdrant_url = st.text_input(
        "Qdrant URL",
        value=os.getenv("QDRANT_URL", "https://qdrant.levinkeller.de:443"),
        help="URL des Qdrant-Servers"
    )
    qdrant_api_key = st.text_input(
        "Qdrant API Key",
        value=os.getenv("QDRANT_API_KEY", ""),
        type="password",
        help="API Key für Qdrant"
    )
    qdrant_collection = st.text_input(
        "Collection Name",
        value=os.getenv("QDRANT_COLLECTION", "nordstemmen"),
        help="Name der Qdrant Collection"
    )

    st.subheader("Anthropic")
    anthropic_api_key = st.text_input(
        "Anthropic API Key",
        value=os.getenv("ANTHROPIC_API_KEY", ""),
        type="password",
        help="Dein Anthropic API Key"
    )

    st.subheader("Suche")
    search_limit = st.slider(
        "Anzahl Suchergebnisse",
        min_value=1,
        max_value=10,
        value=5,
        help="Wie viele Dokumente sollen durchsucht werden?"
    )

    st.divider()

    if st.button("🗑️ Chat leeren"):
        st.session_state.messages = []
        st.rerun()

# Initialize session state
if "messages" not in st.session_state:
    st.session_state.messages = []

# Cache model and clients
@st.cache_resource
def load_embedding_model():
    """Load the sentence transformer model"""
    return SentenceTransformer('paraphrase-multilingual-MiniLM-L12-v2')

@st.cache_resource
def get_qdrant_client(url, api_key):
    """Create Qdrant client"""
    return QdrantClient(
        url=url,
        api_key=api_key,
        timeout=30,
    )

def search_qdrant(query: str, client: QdrantClient, model: SentenceTransformer, collection: str, limit: int):
    """Search Qdrant for relevant documents"""
    try:
        # Generate embedding for query
        query_embedding = model.encode(query).tolist()

        # Search in Qdrant
        results = client.search(
            collection_name=collection,
            query_vector=query_embedding,
            limit=limit,
            with_payload=True,
        )

        return results
    except Exception as e:
        st.error(f"Fehler bei der Qdrant-Suche: {e}")
        return []

def query_claude(question: str, context_chunks: list, api_key: str):
    """Query Claude with context from Qdrant"""
    try:
        client = Anthropic(api_key=api_key)

        # Build context from search results
        context = "\n\n".join([
            f"**Dokument: {chunk.payload.get('filename', 'Unbekannt')}** (Seite {chunk.payload.get('page', '?')})\n{chunk.payload.get('text', '')}"
            for chunk in context_chunks
        ])

        # Create prompt
        system_prompt = """Du bist ein hilfreicher Assistent für die Gemeinde Nordstemmen.
Du beantwortest Fragen basierend auf den bereitgestellten Dokumenten aus Gemeinderatssitzungen, Beschlussvorlagen und anderen offiziellen Dokumenten.

Wichtig:
- Antworte nur basierend auf den bereitgestellten Dokumenten
- Wenn du die Antwort nicht in den Dokumenten findest, sage das klar
- Gib immer die Quelle an (Dateiname und Seite)
- Antworte auf Deutsch
"""

        user_prompt = f"""Hier sind relevante Dokumente aus der Gemeinde Nordstemmen:

{context}

---

Frage: {question}

Bitte beantworte die Frage basierend auf den obigen Dokumenten. Gib die Quellen an."""

        # Call Claude API
        message = client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=2000,
            temperature=0,
            system=system_prompt,
            messages=[
                {"role": "user", "content": user_prompt}
            ]
        )

        return message.content[0].text

    except Exception as e:
        return f"Fehler bei der Claude-Abfrage: {e}"

# Main UI
st.title("💬 Nordstemmen Chat")
st.caption("Stelle Fragen zu den Dokumenten der Gemeinde Nordstemmen")

# Check if all required configs are set
if not qdrant_url or not qdrant_api_key or not qdrant_collection:
    st.warning("⚠️ Bitte konfiguriere Qdrant in der Sidebar")
    st.stop()

if not anthropic_api_key:
    st.warning("⚠️ Bitte gib deinen Anthropic API Key in der Sidebar ein")
    st.stop()

# Load model and client
try:
    with st.spinner("Lade Embedding-Modell..."):
        embedding_model = load_embedding_model()

    qdrant_client = get_qdrant_client(qdrant_url, qdrant_api_key)

    # Test connection
    collection_info = qdrant_client.get_collection(qdrant_collection)
    st.success(f"✅ Verbunden mit Qdrant - {collection_info.points_count} Dokumente in der Collection")

except Exception as e:
    st.error(f"❌ Verbindungsfehler: {e}")
    st.stop()

# Display chat messages
for message in st.session_state.messages:
    with st.chat_message(message["role"]):
        st.markdown(message["content"])

        # Show sources for assistant messages
        if message["role"] == "assistant" and "sources" in message:
            with st.expander("📚 Quellen anzeigen"):
                for i, source in enumerate(message["sources"], 1):
                    filename_display = source['filename']
                    if source.get('access_url'):
                        filename_display = f"[{source['filename']}]({source['access_url']})"

                    st.markdown(f"""
**{i}. {filename_display}** (Seite {source['page']}, Score: {source['score']:.3f})
> {source['text'][:200]}...
                    """)

# Chat input
if prompt := st.chat_input("Stelle eine Frage..."):
    # Add user message
    st.session_state.messages.append({"role": "user", "content": prompt})

    with st.chat_message("user"):
        st.markdown(prompt)

    # Search Qdrant and query Claude
    with st.chat_message("assistant"):
        with st.spinner("Suche in den Dokumenten..."):
            search_results = search_qdrant(
                prompt,
                qdrant_client,
                embedding_model,
                qdrant_collection,
                search_limit
            )

        if not search_results:
            response = "Ich konnte keine relevanten Dokumente finden."
            st.markdown(response)
        else:
            with st.spinner("Generiere Antwort..."):
                response = query_claude(prompt, search_results, anthropic_api_key)

            st.markdown(response)

            # Prepare sources
            sources = [
                {
                    "filename": result.payload.get("filename", "Unbekannt"),
                    "page": result.payload.get("page", "?"),
                    "text": result.payload.get("text", ""),
                    "score": result.score,
                    "access_url": result.payload.get("access_url", None),
                    "oparl_id": result.payload.get("oparl_id", None)
                }
                for result in search_results
            ]

            # Show sources
            with st.expander("📚 Quellen anzeigen"):
                for i, source in enumerate(sources, 1):
                    filename_display = source['filename']
                    if source['access_url']:
                        filename_display = f"[{source['filename']}]({source['access_url']})"

                    st.markdown(f"""
**{i}. {filename_display}** (Seite {source['page']}, Score: {source['score']:.3f})
> {source['text'][:200]}...
                    """)

            # Add assistant message with sources
            st.session_state.messages.append({
                "role": "assistant",
                "content": response,
                "sources": sources
            })
