const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');

const s3 = new S3Client();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
    // Récupérer les infos du fichier CSV uploadé
    const bucket = event.Records[0].s3.bucket.name;
    const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));

    // Lire le fichier CSV depuis S3
    const csvData = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const csvBody = await streamToString(csvData.Body);
    const records = parse(csvBody, { columns: true });

    // Générer une description pour chaque ligne
    let output = '';
    for (const row of records) {
        const prompt = `Génère une description attrayante pour l'article suivant : ${JSON.stringify(row)}`;
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Tu es un expert en marketing et en vente en ligne. Tu es capable de générer des descriptions attrayantes pour des articles de vente en ligne a destination de Vinted.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7
        });
        output += completion.choices[0].message.content + '\n\n';
    }

    // Déposer le fichier texte dans un autre dossier du S3
    const outputKey = key.replace(/^([^/]+\/)*/, 'output/').replace(/\.csv$/i, '.txt');
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: outputKey,
        Body: output,
        ContentType: 'text/plain; charset=utf-8'
    }));

    return { statusCode: 200, body: 'Descriptions générées et déposées dans S3.' };
};

// Helper pour convertir un stream en string
function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
} 