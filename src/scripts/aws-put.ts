import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// ── Config ───────────────────────────────────────────────────────────
const ARTIFACTS = [
    {
        source: 'dist/main.min.4.js',
        keys: ['sdk/main.min.4.js', 'sdk/main.min.js', 'sdk/dist/main.min.js', 'sdk/dist/main.min.4.js'],
    },
    {
        source: 'dist/security-worker.min.js',
        keys: ['sdk/security-worker.min.js', 'sdk/dist/security-worker.min.js'],
    },
]

// ── Env validation ───────────────────────────────────────────────────
const required = [
    'AWS_S3_BUCKET',
    'AWS_S3_REGION',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
] as const

for (const key of required) {
    if (!process.env[key]) {
        console.error(`Missing env var: ${key}`)
        process.exit(1)
    }
}

// ── Upload ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
    const client = new S3Client({
        region: process.env.AWS_S3_REGION,
        credentials: {
            accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
    })

    for (const artifact of ARTIFACTS) {
        const filePath = resolve(artifact.source)
        let body: Buffer

        try {
            body = await readFile(filePath)
        } catch {
            console.error(`File not found: ${filePath}\nRun "npm run build" first.`)
            process.exit(1)
        }

        console.log(`Uploading ${artifact.source} (${(body.length / 1024).toFixed(1)} KB) to s3://${process.env.AWS_S3_BUCKET}`)

        for (const key of artifact.keys) {
            const command = new PutObjectCommand({
                Bucket:      process.env.AWS_S3_BUCKET,
                Key:         key,
                Body:        body,
                ContentType: 'application/javascript',
            })

            await client.send(command)
            console.log(`  [S3] ${key}`)
        }
    }

    console.log('\nAll uploads completed successfully.')
}

main()
