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
        min_value=3,
        max_value=20,
        value=10,
        help="Wie viele Dokument-Chunks sollen durchsucht werden?"
    )

    expand_context = st.checkbox(
        "Erweiterten Kontext laden",
        value=True,
        help="Lädt benachbarte Chunks für mehr Zusammenhang"
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

def get_surrounding_chunks(client: QdrantClient, collection: str, filename: str, page: int, chunk_index: int, context_window: int = 1):
    """Get surrounding chunks for more context"""
    try:
        from qdrant_client.models import Filter, FieldCondition, MatchValue, Range

        chunks = []
        # Get chunks before and after
        for offset in range(-context_window, context_window + 1):
            if offset == 0:  # Skip the original chunk
                continue

            target_chunk = chunk_index + offset
            if target_chunk < 0:  # Don't go below 0
                continue

            results = client.scroll(
                collection_name=collection,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(key="filename", match=MatchValue(value=filename)),
                        FieldCondition(key="page", match=MatchValue(value=page)),
                        FieldCondition(key="chunk_index", match=MatchValue(value=target_chunk))
                    ]
                ),
                limit=1,
                with_payload=True
            )

            if results[0]:
                chunks.append(results[0][0])

        return chunks
    except Exception as e:
        return []

def search_qdrant(query: str, client: QdrantClient, model: SentenceTransformer, collection: str, limit: int, expand_context: bool = False):
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

        # Optionally expand with surrounding chunks
        if expand_context and results:
            from qdrant_client.models import ScoredPoint
            expanded_results = []
            seen_chunks = set()

            for result in results:
                # Add original chunk
                chunk_key = (result.payload['filename'], result.payload['page'], result.payload['chunk_index'])
                if chunk_key not in seen_chunks:
                    expanded_results.append(result)
                    seen_chunks.add(chunk_key)

                # Get surrounding chunks
                surrounding = get_surrounding_chunks(
                    client,
                    collection,
                    result.payload['filename'],
                    result.payload['page'],
                    result.payload['chunk_index'],
                    context_window=1  # 1 chunk before and after
                )

                for chunk in surrounding:
                    chunk_key = (chunk.payload['filename'], chunk.payload['page'], chunk.payload['chunk_index'])
                    if chunk_key not in seen_chunks:
                        # Convert Record to ScoredPoint with score 0 (context chunks)
                        scored_chunk = ScoredPoint(
                            id=chunk.id,
                            version=chunk.version if hasattr(chunk, 'version') else 0,
                            score=0.0,  # Context chunks get score 0
                            payload=chunk.payload,
                            vector=None
                        )
                        expanded_results.append(scored_chunk)
                        seen_chunks.add(chunk_key)

            return expanded_results

        return results
    except Exception as e:
        st.error(f"Fehler bei der Qdrant-Suche: {e}")
        return []

def query_claude_agentic(question: str, qdrant_client: QdrantClient, embedding_model: SentenceTransformer,
                         collection: str, api_key: str, expand_context: bool = False, conversation_history: list = None):
    """Query Claude with agentic RAG - Claude controls the search"""
    try:
        client = Anthropic(api_key=api_key)

        # Define the search tool for Claude
        tools = [
            {
                "name": "search_documents",
                "description": "Durchsucht die Dokumenten-Datenbank der Gemeinde Nordstemmen nach relevanten Informationen. "
                              "Verwende verschiedene Suchbegriffe und Formulierungen, um alle relevanten Dokumente zu finden. "
                              "Du kannst diese Funktion mehrmals mit unterschiedlichen Suchbegriffen aufrufen.",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "Der Suchbegriff oder die Suchanfrage. Sei spezifisch und verwende relevante Keywords."
                        },
                        "limit": {
                            "type": "integer",
                            "description": "Anzahl der Ergebnisse (Standard: 5, Maximum: 10)",
                            "default": 5
                        }
                    },
                    "required": ["query"]
                }
            }
        ]

        system_prompt = """Du bist ein hilfreicher Assistent für die Gemeinde Nordstemmen.
Du hast Zugriff auf eine Dokumenten-Datenbank mit Gemeinderatssitzungen, Beschlussvorlagen und anderen offiziellen Dokumenten.

WICHTIG - Deine Vorgehensweise:
1. Analysiere die Frage des Nutzers gründlich
2. Überlege dir, welche Suchbegriffe und Keywords relevant sein könnten
3. Nutze das search_documents Tool MEHRMALS mit verschiedenen Suchbegriffen:
   - Verwende spezifische Begriffe aus der Frage
   - Versuche auch Synonyme und verwandte Begriffe
   - Suche nach verschiedenen Aspekten der Frage
4. Analysiere die gefundenen Dokumente
5. Wenn nötig, suche nochmal mit anderen Begriffen
6. Erst wenn du genügend relevante Informationen hast, formuliere deine Antwort

Bei der Antwort:
- Zitiere konkrete Textstellen aus den Dokumenten
- Gib immer die Quelle an (Dateiname und Seite)
- Sei ausführlich und detailliert
- Wenn du nicht genug Informationen findest, sage das klar
- Antworte auf Deutsch
"""

        # Build messages from conversation history
        messages = []
        if conversation_history:
            for msg in conversation_history:
                # Only include role and content, not sources
                messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

        # Add current question
        messages.append({"role": "user", "content": question})

        search_count = 0
        all_sources = []
        max_iterations = 5  # Verhindere Endlosschleifen

        # Agentic loop: Claude kann mehrmals suchen
        for iteration in range(max_iterations):
            response = client.messages.create(
                model="claude-sonnet-4-5-20250929",
                max_tokens=4000,
                temperature=0,
                system=system_prompt,
                tools=tools,
                messages=messages
            )

            # Prüfe ob Claude fertig ist
            if response.stop_reason == "end_turn":
                # Claude hat seine finale Antwort gegeben
                for block in response.content:
                    if hasattr(block, 'text'):
                        return block.text, all_sources
                break

            # Claude will ein Tool benutzen
            if response.stop_reason == "tool_use":
                # Füge Claude's Response zu messages hinzu
                messages.append({"role": "assistant", "content": response.content})

                # Process tool calls
                tool_results = []
                for block in response.content:
                    if block.type == "tool_use":
                        search_count += 1
                        tool_name = block.name
                        tool_input = block.input

                        if tool_name == "search_documents":
                            search_query = tool_input.get("query", "")
                            limit = min(tool_input.get("limit", 5), 10)

                            # Show status to user
                            st.info(f"🔍 Claude sucht: '{search_query}' (Suche #{search_count})")

                            # Perform search
                            results = search_qdrant(
                                search_query,
                                qdrant_client,
                                embedding_model,
                                collection,
                                limit,
                                expand_context
                            )

                            # Format results for Claude
                            results_text = []
                            for i, result in enumerate(results, 1):
                                filename = result.payload.get('filename', 'Unbekannt')
                                page = result.payload.get('page', '?')
                                text = result.payload.get('text', '')
                                # Handle both ScoredPoint and Record objects
                                score = getattr(result, 'score', 0.0)
                                results_text.append(
                                    f"[Ergebnis {i}] {filename} (Seite {page}, Relevanz: {score:.3f}):\n{text}"
                                )

                                # Track sources for display
                                source_info = {
                                    "filename": filename,
                                    "page": page,
                                    "text": text,
                                    "score": score,
                                    "access_url": result.payload.get("access_url"),
                                    "oparl_id": result.payload.get("oparl_id")
                                }
                                if source_info not in all_sources:
                                    all_sources.append(source_info)

                            if not results_text:
                                results_text.append("Keine relevanten Dokumente gefunden.")

                            tool_result = {
                                "type": "tool_result",
                                "tool_use_id": block.id,
                                "content": "\n\n---\n\n".join(results_text)
                            }
                            tool_results.append(tool_result)

                # Add tool results to messages
                messages.append({"role": "user", "content": tool_results})

            else:
                # Unexpected stop reason
                return "Unerwarteter Fehler bei der Verarbeitung.", all_sources

        # Fallback if max iterations reached
        return "Maximale Anzahl an Suchvorgängen erreicht. Bitte stelle eine spezifischere Frage.", all_sources

    except Exception as e:
        st.error(f"Fehler: {e}")
        import traceback
        st.error(traceback.format_exc())
        return f"Fehler bei der Abfrage: {e}", []

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

    # Agentic RAG: Claude controls the search
    with st.chat_message("assistant"):
        with st.spinner("Claude analysiert die Frage..."):
            response, sources = query_claude_agentic(
                prompt,
                qdrant_client,
                embedding_model,
                qdrant_collection,
                anthropic_api_key,
                expand_context,
                conversation_history=st.session_state.messages
            )

        st.markdown(response)

        # Show sources if any were found
        if sources:
            with st.expander(f"📚 Quellen anzeigen ({len(sources)} Dokumente)"):
                for i, source in enumerate(sources, 1):
                    filename_display = source['filename']
                    if source.get('access_url'):
                        filename_display = f"[{source['filename']}]({source['access_url']})"

                    st.markdown(f"""
**{i}. {filename_display}** (Seite {source['page']}, Relevanz: {source['score']:.3f})
> {source['text'][:200]}...
                    """)

        # Add assistant message with sources
        st.session_state.messages.append({
            "role": "assistant",
            "content": response,
            "sources": sources
        })
