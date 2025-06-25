const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');

const s3 = new S3Client();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Sections fixes
const QUI_SOMMES_NOUS = `⚡ Qui sommes-nous ?
Sunset Rider propose des équipements moto reconditionnés alliant qualité, sécurité et écoresponsabilité.
Projet soutenu par la région – une partie des bénéfices est reversée aux accidentés de la route.
Conseils personnalisés 7j/7 sur Vinted et Instagram.`;

const INFOS_SUPP = `🚀 Informations supplémentaires :
📦 Envoi rapide sous 24/48H
🛍️ +500 articles moto et sportswear disponibles
📢 Conseil 7j/7 – Pas de retour pour raison de taille. Les équipements moto ont tendance à tailler petit, n'hésitez pas à partir sur une taille au-dessus.`;

const HASHTAGS = `#alpinestars #dainese #vestemoto #blousonmoto #cuirmoto #helstons #segura #fox #gaerne #revit #ixon #klim #bering #furygan #tcx #forma #spidi #rst #ktm #deuxexmachina #sunsetrider #scott #leatt #forma #johndoe #D3o #richa #dxr #motopascher #ixs #allone #daytona #dorsalemoto #lonerider #enduristan #bottemoto #harleydavidson #protectionmoto #cross #enduro #trail #chaussuremoto #equipementmoto`;

exports.handler = async (event) => {
    console.log('Début de la lambda. Event reçu :', JSON.stringify(event, null, 2));
    try {
        const bucket = event.Records[0].s3.bucket.name;
        const key = decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, ' '));
        console.log(`Bucket : ${bucket}, Key : ${key}`);

        const csvData = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        console.log('Fichier CSV récupéré depuis S3');
        const csvBody = await streamToString(csvData.Body);
        console.log('Contenu du CSV (début) :', csvBody.slice(0, 200));
        const records = parse(csvBody, { columns: true });
        console.log(`Nombre de lignes dans le CSV : ${records.length}`);

        let output = '';
        let i = 0;
        for (const row of records) {
            i++;
            // Générer uniquement la description personnalisée
            const prompt = `Rédige une description attrayante et détaillée pour un article moto d'occasion à vendre sur Vinted, à partir des informations suivantes : ${JSON.stringify(row)}. Ne parle pas de la boutique, des conseils, ni d'informations générales. Ne mets pas de hashtags.`;
            console.log(`Appel OpenAI pour la ligne ${i} :`, prompt);
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'Tu es un expert en marketing et en vente en ligne. Tu es capable de générer des descriptions attrayantes pour des articles de vente en ligne à destination de Vinted.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.7
            });
            const description = completion.choices[0].message.content;
            console.log(`Réponse OpenAI pour la ligne ${i} :`, description);

            // Ajout des sections fixes
            const annonce = `${description}

            ${QUI_SOMMES_NOUS}

            ${INFOS_SUPP}

            ${HASHTAGS}

            🔗 UGS : ${row['Code article'] || row['UGS'] || ''}
            📌 Texte protégé – Toute reproduction interdite.`;
            output += annonce + '\n\n';
        }

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

function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
} 