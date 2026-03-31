"""
AI-powered flashcard generation using OpenRouter's free model
"""
import requests
import json
import os
from pathlib import Path
from dotenv import load_dotenv
import time

# ────────────────────────────────────────────────
# Load OpenRouter API key from .env (project root)
# ────────────────────────────────────────────────

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

OPENROUTER_API_KEY = os.getenv('OPENROUTER_API_KEY', '').strip()
if not OPENROUTER_API_KEY:
    raise ValueError(
        "OPENROUTER_API_KEY environment variable not set! "
        "Check your .env file in the project root."
    )

# ────────────────────────────────────────────────
# Flashcard generation function
# ────────────────────────────────────────────────

def generate_flashcards_from_text(text_content: str, filename: str, num_cards: int = 20):
    """
    Generate flashcards from text content using OpenRouter AI.
    """

    api_url = "https://openrouter.ai/api/v1/chat/completions"

    prompt = f"""You are a helpful assistant that creates educational flashcards from documents.

Based on the following document content, generate {num_cards} high-quality flashcards (question and answer pairs).

Rules:
1. Questions should be clear, specific, and test understanding
2. Answers should be concise but complete
3. Cover the most important concepts, facts, and ideas
4. Vary question types (definitions, explanations, applications, comparisons)
5. Make questions self-contained (don't reference "the document")

Document content:
{text_content[:8000]}

Generate a JSON response with this exact structure:
{{
    "set_title": "A descriptive title based on the document content",
    "cards": [
        {{"question": "Question text here?", "answer": "Answer text here"}},
        {{"question": "Another question?", "answer": "Another answer"}}
    ]
}}

Generate exactly {num_cards} flashcards. Return ONLY valid JSON, no other text."""

    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": "openrouter/free",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
        "max_tokens": 4000,
    }

    try:
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()

        if "choices" not in result or len(result["choices"]) == 0:
            raise ValueError("No response content from AI model")

        content = result['choices'][0]['message']['content'].strip()

        # Remove possible markdown code blocks
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()

        flashcard_data = json.loads(content)

        # Validate structure
        if "cards" not in flashcard_data or not isinstance(flashcard_data["cards"], list):
            raise ValueError("Invalid response structure: missing 'cards' array")
        if not flashcard_data["cards"]:
            raise ValueError("No flashcards were generated")

        # Validate each card
        for i, card in enumerate(flashcard_data["cards"]):
            if "question" not in card or "answer" not in card:
                raise ValueError(f"Card {i+1} missing question or answer")
            if not card["question"].strip() or not card["answer"].strip():
                raise ValueError(f"Card {i+1} has empty question or answer")

        # Fallback title
        if "set_title" not in flashcard_data or not flashcard_data["set_title"].strip():
            flashcard_data["set_title"] = os.path.splitext(filename)[0]

        return flashcard_data

    except requests.exceptions.RequestException as e:
        raise Exception(f"API request failed: {str(e)}")
    except json.JSONDecodeError as e:
        raise Exception(f"Failed to parse AI response as JSON: {str(e)}")
    except Exception as e:
        raise Exception(f"Error generating flashcards: {str(e)}")


# ────────────────────────────────────────────────
# Retry wrapper
# ────────────────────────────────────────────────

def generate_flashcards_with_retry(text_content: str, filename: str, num_cards: int = 20, max_retries: int = 2):
    """
    Generate flashcards with retry logic and exponential backoff.
    """
    last_error = None
    for attempt in range(max_retries + 1):
        try:
            return generate_flashcards_from_text(text_content, filename, num_cards)
        except Exception as e:
            last_error = e
            if attempt < max_retries:
                wait = 2 ** attempt
                print(f"[Retry {attempt+1}/{max_retries}] Waiting {wait}s due to error: {e}")
                time.sleep(wait)
    raise Exception(f"Failed after {max_retries + 1} attempts. Last error: {str(last_error)}")
