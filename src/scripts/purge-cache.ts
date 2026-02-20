import 'dotenv/config'
import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront'
import { cloudflare, CLOUDFLARE_ZONE_ID } from '../config/cloudflare'

// ── Targets ──────────────────────────────────────────────────────────
const CLOUDFRONT_PATHS = [
    '/sdk/main.min.js',
    '/sdk/main.min.4.js',
    '/sdk/dist/main.min.js',
    '/sdk/dist/main.min.4.js',
    '/sdk/security-worker.min.js',
    '/sdk/dist/security-worker.min.js',
]
const CDN_URLS = [
    'https://files.digitap.eu/sdk/main.min.js',
    'https://files.digitap.eu/sdk/main.min.4.js',
    'https://files.digitap.eu/sdk/dist/main.min.js',
    'https://files.digitap.eu/sdk/dist/main.min.4.js',
    'https://files.digitap.eu/sdk/security-worker.min.js',
    'https://files.digitap.eu/sdk/dist/security-worker.min.js',
]

// ── Env validation ───────────────────────────────────────────────────
const required = [
    'BUNNYCDN_API_KEY',
    'CLOUDFLARE_PURGE_CACHE_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_REGION',
    'CLOUDFRONT_DISTRIBUTION_ID',
] as const

for (const key of required) {
    if (!process.env[key]) {
        console.error(`Missing env var: ${key}`)
        process.exit(1)
    }
}

// ── CloudFront ───────────────────────────────────────────────────────
async function purgeCloudFront(): Promise<void> {
    const client = new CloudFrontClient({
        region: process.env.AWS_S3_REGION,
        credentials: {
            accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
    })

    const command = new CreateInvalidationCommand({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: {
            CallerReference: `purge-${Date.now()}`,
            Paths: {
                Quantity: CLOUDFRONT_PATHS.length,
                Items:    CLOUDFRONT_PATHS,
            },
        },
    })

    const result = await client.send(command)
    console.log(`[CloudFront] Invalidation created: ${result.Invalidation?.Id}`)
}

// ── Cloudflare ───────────────────────────────────────────────────────
async function purgeCloudflare(): Promise<void> {
    await cloudflare.cache.purge({
        zone_id: CLOUDFLARE_ZONE_ID,
        files:   CDN_URLS,
    })
    console.log(`[Cloudflare] Purged ${CDN_URLS.length} URLs`)
}

// ── BunnyCDN ─────────────────────────────────────────────────────────
async function purgeBunny(): Promise<void> {
    for (const url of CDN_URLS) {
        const endpoint = `https://api.bunny.net/purge?url=${encodeURIComponent(url)}&async=true`
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                Accept:    'application/json',
                AccessKey: process.env.BUNNYCDN_API_KEY!,
            },
        })

        if (!res.ok) {
            throw new Error(`BunnyCDN purge failed for ${url}: ${res.status} ${res.statusText}`)
        }

        console.log(`[BunnyCDN] Purged: ${url}`)
    }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    console.log('Purging CDN caches...\n')

    const results = await Promise.allSettled([
        purgeCloudFront(),
        purgeCloudflare(),
        purgeBunny(),
    ])

    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    if (failed.length) {
        console.error('\nSome purges failed:')
        failed.forEach(r => console.error(` - ${r.reason}`))
        process.exit(1)
    }

    console.log('\nAll caches purged successfully.')
}

main()
