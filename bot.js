import fs from "node:fs";
import { FxTwitterV2 } from "fxtwitter/v2";

const fx = new FxTwitterV2({
  headers: {
    "User-Agent": "DiscordNewsBot/1.0"
  }
});

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;
const STATE_FILE = "state.json";

const USERNAME = "shinobi602";

const MAX_AGE_MS = 12 * 60 * 60 * 1000;

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
    console.log(
      `Connessione a FxTwitter v2 per @${USERNAME}...`
    );

    const page =
      await fx.getProfileStatuses(
        USERNAME,
        {
          count: 20
        }
      );

    if (!page) {
      console.log(
        "FxTwitter non ha restituito nuovi post."
      );

      return [];
    }

    const results =
      Array.isArray(page.results)
        ? page.results
        : [];

    console.log(
      `FxTwitter ha restituito ${results.length} post`
    );

    const now =
      Date.now();

    const posts =
      results
        .map((tweet) => {
          if (!tweet || !tweet.id) {
            return null;
          }

          let media = null;
          let mediaType = null;

          // ================================================
          // VIDEO
          // ================================================

          if (
            Array.isArray(tweet.media?.videos) &&
            tweet.media.videos.length > 0
          ) {
            const video =
              tweet.media.videos[0];

            mediaType =
              "video";

            media =
              video.url ||
              video.transcode_url ||
              video.thumbnail_url ||
              null;
          }

          // ================================================
          // IMMAGINI
          // ================================================

          if (
            !mediaType &&
            Array.isArray(tweet.media?.photos) &&
            tweet.media.photos.length > 0
          ) {
            const photo =
              tweet.media.photos[0];

            mediaType =
              "image";

            media =
              photo.url ||
              null;
          }

          return {
            id:
              String(tweet.id),

            text:
              tweet.text ||
              "",

            url:
              tweet.url ||
              `https://x.com/${USERNAME}/status/${tweet.id}`,

            created_at:
              tweet.created_at ||
              null,

            author: {
              name:
                tweet.author?.name ||
                USERNAME,

              screen_name:
                tweet.author?.username ||
                tweet.author?.screen_name ||
                USERNAME,

              avatar_url:
                tweet.author?.avatar_url ||
                tweet.author?.profile_image_url ||
                null
            },

            media,
            mediaType,

            stats: {
              replies:
                tweet.replies ?? 0,

              retweets:
                tweet.reposts ?? 0,

              likes:
                tweet.likes ?? 0,

              views:
                tweet.views ?? null
            }
          };
        })
        .filter(Boolean);

    // ================================================
    // FILTRO TEMPORALE
    // ================================================

    const recentPosts =
      posts.filter((post) => {
        if (!post.created_at) {
          console.log(
            `Post ${post.id}: data assente, ignorato`
          );

          return false;
        }

        const tweetTime =
          new Date(
            post.created_at
          ).getTime();

        if (!Number.isFinite(tweetTime)) {
          console.log(
            `Post ${post.id}: data non valida (${post.created_at})`
          );

          return false;
        }

        const age =
          now - tweetTime;

        const ageMinutes =
          Math.round(
            age / 60000
          );

        console.log(
          `Post ${post.id}: ${post.created_at} | ` +
          `età: ${ageMinutes} minuti | ` +
          `${post.mediaType || "text"}`
        );

        if (age < 0) {
          return false;
        }

        if (age > MAX_AGE_MS) {
          return false;
        }

        return true;
      });

    console.log(
      `Post recenti: ${recentPosts.length}`
    );

    return recentPosts;

  } catch (err) {
    console.error(
      "Errore durante la chiamata FxTwitter:",
      err
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
    USERNAME;

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
  // Usa FxTwitter così Discord genera
  // automaticamente il player video.
  //
  // L'avatar del bot Discord NON viene sovrascritto.
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

  const stats = post.stats || {};

  const statsParts = [
    `💬 ${stats.replies ?? 0}`,
    `🔁 ${stats.retweets ?? 0}`,
    `❤️ ${stats.likes ?? 0}`
  ];
  
  if (
    stats.views !== null &&
    stats.views !== undefined
  ) {
    statsParts.push(`👁️ ${stats.views}`);
  }
  
  const statsText = statsParts.join("   ");
  
  const embed = {
    title:
      "🎮 GAME NEWS",

    url:
      post.url,

    description,
    fields: [
      {
        name: "\u200b",
        value: statsText
      }
    ],

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
        "Game News • X"
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

  // ==========================================================
  // PAYLOAD
  // ==========================================================
  //
  // NON mettiamo avatar_url.
  // Discord usa automaticamente la foto configurata
  // direttamente nel webhook.
  //
  // ==========================================================

  const payload = {
    username:
      "Lord Putin",
    content:
    `<${post.url}>`,

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

      // Viene salvato nello state solo
      // dopo che Discord lo ha accettato.
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
