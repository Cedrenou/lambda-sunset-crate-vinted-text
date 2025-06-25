const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');

const s3 = new S3Client();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
    console.log('Début de la lambda. Event reçu :', JSON.stringify(event, null, 2));
    try {
        // Récupérer les infos du fichier CSV uploadé
        const bucket = event.Records[0].s3.bucket.name;
        const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
        console.log(`Bucket : ${bucket}, Key : ${key}`);

        // Lire le fichier CSV depuis S3
        const csvData = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        console.log('Fichier CSV récupéré depuis S3');
        const csvBody = await streamToString(csvData.Body);
        console.log('Contenu du CSV (début) :', csvBody.slice(0, 200));
        const records = parse(csvBody, { columns: true });
        console.log(`Nombre de lignes dans le CSV : ${records.length}`);

        // Générer une description pour chaque ligne
        let output = '';
        let i = 0;
        for (const row of records) {
            i++;
            const prompt = `Génère une description attrayante pour l'article suivant : ${JSON.stringify(row)}`;
            console.log(`Appel OpenAI pour la ligne ${i} :`, prompt);
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'Tu es un expert en marketing et en vente en ligne. Tu es capable de générer des descriptions attrayantes pour des articles de vente en ligne a destination de Vinted.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            });
            const description = completion.choices[0].message.content;
            console.log(`Réponse OpenAI pour la ligne ${i} :`, description);
            output += description + '\n\n';
        }

        // Déposer le fichier texte dans un autre dossier du S3
        const outputKey = key.replace(/^([^/]+\/)*/, 'output/').replace(/\.csv$/i, '.txt');
        console.log(`Écriture du fichier texte dans S3 : ${outputKey}`);
        await s3.send(new PutObjectCommand({
            Bucket: bucket,
            Key: outputKey,
            Body: output,
            ContentType: 'text/plain; charset=utf-8'
        }));
        console.log('Fichier texte écrit avec succès dans S3');

        return { statusCode: 200, body: 'Descriptions générées et déposées dans S3.' };
    } catch (error) {
        console.error('Erreur pendant l\'exécution de la lambda :', error);
        throw error;
    }
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