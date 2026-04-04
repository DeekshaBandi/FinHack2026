"""
RAG Corpus Ingestion Script

Reads markdown files from the corpus folder, chunks them, generates embeddings,
and stores them in ChromaDB for retrieval.

Usage:
    python -m app.rag.ingest

Requirements:
    - sentence-transformers
    - chromadb
"""

import os
import re
from pathlib import Path

CORPUS_DIR = Path(__file__).parent / "corpus"
CHROMA_DB_PATH = Path(__file__).parent / "chroma_db"
COLLECTION_NAME = "climate_docs"
CHUNK_SIZE = 500  # tokens (approximately)
CHUNK_OVERLAP = 50


def load_documents() -> list[dict]:
    """Load all markdown files from the corpus directory."""
    documents = []
    
    if not CORPUS_DIR.exists():
        print(f"Corpus directory not found: {CORPUS_DIR}")
        return documents
    
    for filepath in CORPUS_DIR.glob("*.md"):
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
        
        documents.append({
            "filename": filepath.name,
            "source": filepath.stem.replace("_", " ").title(),
            "content": content,
        })
        print(f"Loaded: {filepath.name}")
    
    return documents


def chunk_document(doc: dict, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """Split a document into overlapping chunks."""
    content = doc["content"]
    chunks = []
    
    # Split by sections (## headers) first
    sections = re.split(r'\n(?=## )', content)
    
    for section in sections:
        # If section is small enough, keep it whole
        words = section.split()
        if len(words) <= chunk_size:
            if section.strip():
                chunks.append({
                    "content": section.strip(),
                    "source": doc["source"],
                    "filename": doc["filename"],
                })
        else:
            # Split large sections into smaller chunks
            current_chunk = []
            current_size = 0
            
            paragraphs = section.split("\n\n")
            for para in paragraphs:
                para_words = para.split()
                para_size = len(para_words)
                
                if current_size + para_size > chunk_size and current_chunk:
                    chunk_text = "\n\n".join(current_chunk)
                    if chunk_text.strip():
                        chunks.append({
                            "content": chunk_text.strip(),
                            "source": doc["source"],
                            "filename": doc["filename"],
                        })
                    # Keep overlap
                    overlap_paras = current_chunk[-1:] if current_chunk else []
                    current_chunk = overlap_paras
                    current_size = sum(len(p.split()) for p in current_chunk)
                
                current_chunk.append(para)
                current_size += para_size
            
            # Add remaining content
            if current_chunk:
                chunk_text = "\n\n".join(current_chunk)
                if chunk_text.strip():
                    chunks.append({
                        "content": chunk_text.strip(),
                        "source": doc["source"],
                        "filename": doc["filename"],
                    })
    
    return chunks


def ingest_to_chromadb(chunks: list[dict]) -> None:
    """Generate embeddings and store in ChromaDB using built-in embedding function."""
    try:
        import chromadb
        from chromadb.utils import embedding_functions
    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Install with: pip install chromadb")
        return
    
    print(f"\nCreating ChromaDB at: {CHROMA_DB_PATH}")
    CHROMA_DB_PATH.mkdir(parents=True, exist_ok=True)
    
    client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
    
    # Delete existing collection if it exists
    try:
        client.delete_collection(COLLECTION_NAME)
        print(f"Deleted existing collection: {COLLECTION_NAME}")
    except Exception:
        pass
    
    # Use ChromaDB's built-in embedding function (uses all-MiniLM-L6-v2 by default)
    print(f"Loading embedding model via ChromaDB...")
    embedding_fn = embedding_functions.DefaultEmbeddingFunction()
    
    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"description": "Climate risk documents for RAG"},
        embedding_function=embedding_fn
    )
    
    print(f"\nProcessing {len(chunks)} chunks...")
    
    # Prepare data for batch insert
    ids = []
    documents = []
    metadatas = []
    
    for i, chunk in enumerate(chunks):
        chunk_id = f"chunk_{i:04d}"
        ids.append(chunk_id)
        documents.append(chunk["content"])
        metadatas.append({
            "source": chunk["source"],
            "filename": chunk["filename"],
        })
        
        if (i + 1) % 10 == 0:
            print(f"  Processed {i + 1}/{len(chunks)} chunks...")
    
    print(f"\nInserting {len(chunks)} chunks into ChromaDB (embeddings generated automatically)...")
    collection.add(
        ids=ids,
        documents=documents,
        metadatas=metadatas,
    )
    
    print(f"\nIngestion complete!")
    print(f"  Collection: {COLLECTION_NAME}")
    print(f"  Total chunks: {len(chunks)}")
    print(f"  Database path: {CHROMA_DB_PATH}")


def test_retrieval(query: str = "What is Valero's hurricane exposure?") -> None:
    """Test retrieval from the ingested corpus."""
    try:
        import chromadb
        from chromadb.utils import embedding_functions
    except ImportError:
        return
    
    print(f"\n--- Testing Retrieval ---")
    print(f"Query: {query}\n")
    
    embedding_fn = embedding_functions.DefaultEmbeddingFunction()
    client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
    collection = client.get_collection(COLLECTION_NAME, embedding_function=embedding_fn)
    
    results = collection.query(
        query_texts=[query],
        n_results=3,
        include=["documents", "metadatas", "distances"]
    )
    
    for i, (doc, meta, dist) in enumerate(zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0]
    )):
        print(f"Result {i + 1} (distance: {dist:.4f}):")
        print(f"  Source: {meta['source']}")
        print(f"  Content: {doc[:200]}...")
        print()


def main():
    print("=" * 60)
    print("Climate Risk RAG Corpus Ingestion")
    print("=" * 60)
    
    # Load documents
    print("\n1. Loading documents from corpus...")
    documents = load_documents()
    
    if not documents:
        print("No documents found. Add .md files to backend/app/rag/corpus/")
        return
    
    print(f"\nLoaded {len(documents)} documents")
    
    # Chunk documents
    print("\n2. Chunking documents...")
    all_chunks = []
    for doc in documents:
        chunks = chunk_document(doc)
        all_chunks.extend(chunks)
        print(f"  {doc['filename']}: {len(chunks)} chunks")
    
    print(f"\nTotal chunks: {len(all_chunks)}")
    
    # Ingest to ChromaDB
    print("\n3. Ingesting to ChromaDB...")
    ingest_to_chromadb(all_chunks)
    
    # Test retrieval
    test_retrieval("What is Valero's hurricane exposure?")
    test_retrieval("How does Allstate handle catastrophe losses?")
    
    print("\n" + "=" * 60)
    print("Ingestion Complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
