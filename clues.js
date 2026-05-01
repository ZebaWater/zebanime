// clues.js — clue ladder definition and extraction from Jikan API data

// Ordered from least → most revealing
export const CLUE_DEFINITIONS = [
  {
    id: "episodes",
    label: "Episodes",
    extract: (data) => {
      const ep = data.episodes;
      if (!ep) return "Unknown";
      if (ep === 1) return "1 episode (Film or OVA)";
      if (ep <= 13) return `${ep} episodes (Short cour)`;
      if (ep <= 26) return `${ep} episodes (Standard cour)`;
      return `${ep}+ episodes (Long-running)`;
    }
  },
  {
    id: "studio",
    label: "Studio",
    extract: (data) => {
      const studios = data.studios?.map(s => s.name);
      return studios?.length ? studios.join(", ") : "Unknown Studio";
    }
  },
  {
    id: "voice_actor",
    label: "Main VA (Japanese)",
    extract: (data) => {
      // characters come from a separate endpoint; we'll store this from enrichment
      return data._mainVA || "Unknown";
    }
  },
  {
    id: "demographic",
    label: "Demographic",
    extract: (data) => {
      const demos = data.demographics?.map(d => d.name);
      const themes = data.themes?.map(t => t.name).slice(0, 2);
      const parts = [];
      if (demos?.length)  parts.push(demos.join(", "));
      if (themes?.length) parts.push(themes.join(", "));
      return parts.length ? parts.join(" · ") : "Unknown";
    }
  },
  {
    id: "season",
    label: "Season & Year",
    extract: (data) => {
      const season = data.season ? capitalize(data.season) : null;
      const year   = data.year   ? data.year : null;
      if (season && year) return `${season} ${year}`;
      if (year) return String(year);
      return "Unknown";
    }
  },
  {
    id: "genres",
    label: "Genres",
    extract: (data) => {
      const genres = data.genres?.map(g => g.name);
      return genres?.length ? genres.join(", ") : "Unknown";
    }
  },
  {
    id: "score_range",
    label: "Score Range",
    extract: (data) => {
      const score = data.score;
      if (!score) return "Unscored";
      const floor = Math.floor(score * 10) / 10;
      return `${floor.toFixed(1)}x / 10`;
    }
  },
  {
    id: "rank_bracket",
    label: "MAL Rank",
    extract: (data) => {
      const rank = data.rank;
      if (!rank) return "Unranked";
      if (rank <= 50)   return `Top 50 (#${rank})`;
      if (rank <= 100)  return `Top 100 (#${rank})`;
      if (rank <= 250)  return `Top 250`;
      if (rank <= 500)  return `Top 500`;
      if (rank <= 1000) return `Top 1000`;
      return `Rank #${rank}`;
    }
  },
  {
    id: "synopsis_short",
    label: "Synopsis (Partial)",
    extract: (data) => {
      const syn = data.synopsis;
      if (!syn) return "No synopsis available.";
      // First sentence only, max 120 chars
      const first = syn.split(/[.!?]/)[0];
      return first.length > 120 ? first.slice(0, 120) + "…" : first + ".";
    }
  },
  {
    id: "synopsis_full",
    label: "Full Synopsis",
    extract: (data) => {
      const syn = data.synopsis;
      if (!syn) return "No synopsis available.";
      return syn.length > 300 ? syn.slice(0, 300) + "…" : syn;
    }
  }
];

export const TOTAL_CLUES = CLUE_DEFINITIONS.length; // 10

function capitalize(str) {
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
}

/**
 * Build clue value strings from raw Jikan anime data.
 * Returns array of { id, label, value } in reveal order.
 */
export function buildClueValues(animeData) {
  return CLUE_DEFINITIONS.map(def => ({
    id:    def.id,
    label: def.label,
    value: def.extract(animeData)
  }));
}