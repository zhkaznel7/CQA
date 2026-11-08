import { ApiError } from '../middleware/api-error.js';

// Confirmed organizer vocabulary (data/dev.json); no inferred speaker aliases.
const speakers = new Set(['operator', 'client', 'system', 'bot']);

function timestampForAi(turn, turnIndex) {
  // A real startMs is source data, not a fabricated replacement or an inferred date.
  const timestamp = turn.timestamp ?? turn.startMs;
  if (timestamp === undefined || timestamp === null) {
    throw new ApiError(422, 'AI_TIMESTAMP_REQUIRED', 'Transcript time is unavailable; AI request was not sent', [{ turnIndex, field: 'timestamp' }]);
  }
  if (typeof timestamp === 'string' && timestamp.trim().length > 0) return timestamp;
  if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0
    && (!Number.isInteger(timestamp) || Number.isSafeInteger(timestamp))) return String(timestamp);
  throw new ApiError(422, 'AI_TIMESTAMP_INVALID', 'Transcript time cannot be safely represented for AI', [{ turnIndex, field: 'timestamp' }]);
}

/** Build a separate wire transcript. Never sort, filter, mutate or persist source turns. */
export function toAiTranscript(transcript) {
  if (!Array.isArray(transcript) || !transcript.length
    || transcript.some((turn, index) => !turn || typeof turn.text !== 'string' || !turn.text.trim()
      || typeof turn.speaker !== 'string' || !turn.speaker.trim() || (turn.turnIndex !== undefined && turn.turnIndex !== index))) {
    throw new ApiError(422, 'INVALID_TRANSCRIPT', 'Conversation has no valid indexed transcript');
  }
  return transcript.map((turn, turnIndex) => {
    // Only case and surrounding whitespace of a known role are normalized.
    const speaker = turn.speaker.trim().toLowerCase();
    if (!speakers.has(speaker)) {
      throw new ApiError(422, 'AI_SPEAKER_UNSUPPORTED', 'Transcript contains an unsupported speaker role; AI request was not sent', [{ turnIndex, field: 'speaker' }]);
    }
    return { turnIndex, timestamp: timestampForAi(turn, turnIndex), speaker, text: turn.text };
  });
}
