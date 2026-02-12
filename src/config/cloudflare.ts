import Cloudflare from 'cloudflare'

export const cloudflare = new Cloudflare({
    apiToken: process.env.CLOUDFLARE_PURGE_CACHE_KEY,
})

export const CLOUDFLARE_ZONE_ID = '356e0035217cc434cfde9c2e1fa851f7' // digitap.eu

export const cloudflareZone = '356e0035217cc434cfde9c2e1fa851f7' // digitap.eu
