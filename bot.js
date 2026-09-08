import fs from "node:fs";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const STATE_FILE = "state.json";

const USERNAME = "shinobi602";

// Accetta solamente post degli ultimi 30 minuti.
// Lo state impedisce comunque i duplicati.
const MAX_AGE_MS = 60 * 60 * 1000;

// ============================================================
// STATE
// ============================================================

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(
        fs.readFileSync(STATE_FILE, "utf8")
      );

      if (Array.isArray(data.ids)) {
        return data;
      }
    }
  } catch (err) {
    console.error("Errore lettura state.json:", err);
  }

  return { ids: [] };
}

function saveState(ids) {
  try {
    const uniqueIds = [...new Set(ids)].slice(-200);

    fs.writeFileSync(
      STATE_FILE,
      JSON.stringify(
        {
          ids: uniqueIds
        },
        null,
        2
      )
    );
  } catch (err) {
    console.error("Errore scrittura state.json:", err);
  }
}

// ============================================================
// UTILITY
// ============================================================

function cleanText(text) {
  if (!text) return "";

  return text
    .replace(/https:\/\/t\.co\/\w+/g, "")
    .trim();
}

function truncate(text, length) {
  if (!text) return "";

  if (text.length <= length) {
    return text;
  }

  return text.slice(0, length - 3) + "...";
}

function getFxTwitterUrl(postUrl) {
  if (!postUrl) return null;

  return postUrl
    .replace(
      "https://twitter.com/",
      "https://fxtwitter.com/"
    )
    .replace(
      "https://x.com/",
      "https://fxtwitter.com/"
    );
}

// ============================================================
// RECUPERA POST DA VXTwitter
// ============================================================

async function getPosts() {
  try {
    const url =
      `https://api.vxtwitter.com/${USERNAME}?with_tweets=true`;

    console.log(`Connessione a: ${url}`);

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    if (!response.ok) {
      console.error(
        `VXTwitter HTTP ${response.status}`
      );

      console.error(
        await response.text()
      );

      return [];
    }

    const data = await response.json();

    if (!Array.isArray(data.latest_tweets)) {
      console.error(
        "VXTwitter non ha restituito latest_tweets."
      );

      return [];
    }

    console.log(
      `VXTwitter ha restituito ${data.latest_tweets.length} tweet`
    );

    const now = Date.now();

    // ========================================================
    // CONVERSIONE TWEET
    // ========================================================

    const posts = data.latest_tweets
      .map((tweet) => {
        const tweetId =
          tweet.tweetID ||
          tweet.id;

        if (!tweetId) {
          return null;
        }

        const createdAt =
          tweet.date ||
          null;

        // ====================================================
        // MEDIA
        // ====================================================

        let media = null;
        let mediaType = null;

        const extended =
          Array.isArray(tweet.media_extended)
            ? tweet.media_extended
            : [];

        // ----------------------------------------------------
        // VIDEO
        // ----------------------------------------------------

        const videoMedia = extended.find(
          (item) =>
            item &&
            item.type === "video"
        );

        if (videoMedia) {
          mediaType = "video";

          media =
            videoMedia.url ||
            null;
        }

        // ----------------------------------------------------
        // IMMAGINE
        // ----------------------------------------------------

        if (!mediaType) {
          const imageMedia = extended.find(
            (item) =>
              item &&
              item.type === "image"
          );

          if (imageMedia) {
            mediaType = "image";

            media =
              imageMedia.url ||
              imageMedia.thumbnail_url ||
              null;
          }
        }

        // ----------------------------------------------------
        // FALLBACK mediaURLs
        // ----------------------------------------------------

        if (
          !mediaType &&
          Array.isArray(tweet.mediaURLs) &&
          tweet.mediaURLs.length > 0
        ) {
          const firstMedia =
            tweet.mediaURLs[0];

          media = firstMedia;

          const mediaUrl =
            String(firstMedia).toLowerCase();

          if (
            mediaUrl.includes(".mp4") ||
            mediaUrl.includes("video.twimg.com") ||
            mediaUrl.includes(".m3u8")
          ) {
            mediaType = "video";
          } else {
            mediaType = "image";
          }
        }

        return {
          id: String(tweetId),

          text:
            tweet.text ||
            "",

          url:
            tweet.tweetURL ||
            `https://x.com/${USERNAME}/status/${tweetId}`,

          created_at:
            createdAt,

          author: {
            name:
              tweet.user_name ||
              "Anime News And Facts",

            screen_name:
              tweet.user_screen_name ||
              USERNAME,

            avatar_url:
              tweet.user_profile_image_url ||
              null
          },

          media,
          mediaType
        };
      })
      .filter(Boolean);

    // ========================================================
    // FILTRO TEMPORALE
    // ========================================================

    const recentPosts =
      posts.filter((post) => {
        if (!post.created_at) {
          console.log(
            `Tweet ${post.id}: data assente, ignorato`
          );

          return false;
        }

        const tweetTime =
          new Date(post.created_at).getTime();

        if (!Number.isFinite(tweetTime)) {
          console.log(
            `Tweet ${post.id}: data non valida (${post.created_at})`
          );

          return false;
        }

        const age =
          now - tweetTime;

        const ageMinutes =
          Math.round(age / 60000);

        console.log(
          `Tweet ${post.id}: ${post.created_at} | ` +
          `età: ${ageMinutes} minuti | ` +
          `${post.mediaType || "text"}`
        );

        // Data futura
        if (age < 0) {
          return false;
        }

        // Troppo vecchio
        if (age > MAX_AGE_MS) {
          return false;
        }

        return true;
      });

    console.log(
      `Tweet recenti: ${recentPosts.length}`
    );

    return recentPosts;

  } catch (err) {
    console.error(
      "Errore durante la chiamata VXTwitter:",
      err.message
    );

    return [];
  }
}

// ============================================================
// INVIO DISCORD
// ============================================================

async function sendToDiscord(post) {
  const author =
    post.author ||
    {};

  const authorName =
    author.name ||
    "Anime News And Facts";

  const username =
    author.screen_name ||
    USERNAME;

  const avatar =
    author.avatar_url ||
    undefined;

  // ==========================================================
  // VIDEO
  // ==========================================================
  //
  // Formato che abbiamo verificato nel TEST 2.
  //
  // Mandiamo il link FxTwitter come normale messaggio.
  // Discord genera automaticamente la scheda con:
  //
  // - testo del tweet
  // - autore
  // - statistiche
  // - player video
  //
  // ==========================================================

  if (post.mediaType === "video") {
    const fxUrl =
      getFxTwitterUrl(post.url);

    if (!fxUrl) {
      throw new Error(
        "Impossibile creare URL FxTwitter"
      );
    }

    console.log(
      `Invio VIDEO tramite FxTwitter: ${fxUrl}`
    );

    const payload = {
      username:
        "Lord Putin",

      ...(avatar
        ? {
            avatar_url: avatar
          }
        : {}),

      content:
        fxUrl
    };

    const response =
      await fetch(WEBHOOK, {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      });

    if (!response.ok) {
      const errorText =
        await response.text();

      throw new Error(
        `Discord error ${response.status}: ${errorText}`
      );
    }

    console.log(
      "Video accettato da Discord."
    );

    return;
  }

  // ==========================================================
  // IMMAGINE / TESTO
  // ==========================================================

  const textContent =
    cleanText(post.text || "");

  const description =
    textContent.length > 0
      ? truncate(textContent, 4000)
      : " ";

  let isoTimestamp;

  try {
    isoTimestamp =
      post.created_at
        ? new Date(
            post.created_at
          ).toISOString()
        : new Date().toISOString();
  } catch {
    isoTimestamp =
      new Date().toISOString();
  }

  const embed = {
    title:
      "📰 ANIME NEWS",

    url:
      post.url,

    description,

    color:
      0x5865f2,

    author: {
      name:
        `${authorName} (@${username})`,

      url:
        `https://x.com/${username}`,

      ...(avatar
        ? {
            icon_url: avatar
          }
        : {})
    },

    footer: {
      text:
        "Anime News & Facts • X"
    },

    timestamp:
      isoTimestamp
  };

  // ==========================================================
  // IMMAGINE
  // ==========================================================

  if (
    post.mediaType === "image" &&
    post.media
  ) {
    embed.image = {
      url:
        post.media
    };
  }

  const payload = {
    username:
      "Anime News & Facts",

    ...(avatar
      ? {
          avatar_url: avatar
        }
      : {}),

    embeds: [
      embed
    ]
  };

  const response =
    await fetch(WEBHOOK, {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json"
      },

      body:
        JSON.stringify(payload)
    });

  if (!response.ok) {
    const errorText =
      await response.text();

    throw new Error(
      `Discord error ${response.status}: ${errorText}`
    );
  }

  console.log(
    "Post accettato da Discord."
  );
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  if (!WEBHOOK) {
    console.error(
      "DISCORD_WEBHOOK_URL non impostata!"
    );

    process.exit(1);
  }

  // ==========================================================
  // CARICA STATE
  // ==========================================================

  const state =
    loadState();

  console.log(
    `State: ${state.ids.length} ID salvati.`
  );

  // ==========================================================
  // RECUPERA TWEET
  // ==========================================================

  const posts =
    await getPosts();

  if (!posts.length) {
    console.log(
      "Nessun post recente trovato."
    );

    return;
  }

  // ==========================================================
  // RIMUOVE QUELLI GIÀ PUBBLICATI
  // ==========================================================

  const newPosts =
    posts.filter(
      (post) =>
        !state.ids.includes(post.id)
    );

  if (!newPosts.length) {
    console.log(
      "Nessun nuovo post da pubblicare."
    );

    return;
  }

  // ==========================================================
  // ORDINE DAL PIÙ VECCHIO AL PIÙ NUOVO
  // ==========================================================

  const sortedPosts =
    [...newPosts].sort(
      (a, b) =>
        new Date(
          a.created_at
        ).getTime() -
        new Date(
          b.created_at
        ).getTime()
    );

  console.log(
    `Nuovi post da pubblicare: ${sortedPosts.length}`
  );

  // ==========================================================
  // INVIO
  // ==========================================================

  for (const post of sortedPosts) {
    console.log(
      `Pubblico ${post.id} | ` +
      `${post.created_at} | ` +
      `${post.mediaType || "text"}`
    );

    try {
      await sendToDiscord(post);

      // Lo aggiungiamo allo state soltanto
      // se Discord ha accettato il messaggio.
      state.ids.push(
        post.id
      );

      console.log(
        `Post ${post.id} inviato correttamente.`
      );

    } catch (err) {
      console.error(
        `Errore invio post ${post.id}:`,
        err.message
      );
    }
  }

  // ==========================================================
  // SALVA STATE
  // ==========================================================

  saveState(
    state.ids
  );
}

// ============================================================
// START
// ============================================================

main().catch((err) => {
  console.error(err);

  process.exit(1);
});
