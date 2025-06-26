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

const UGS_ET_PROTECTION = (ugs) => `\n🔗 UGS : ${ugs}\n📌 Texte protégé – Toute reproduction interdite.`;

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
            // Construction de la section Caractéristiques
            let caracteristiques = `✨ État : ${row['État'] || row['Etat'] || ''}\n` +
                `🛡️ Protections : ${row['Protections'] || ''}\n` +
                `✅ Taille : ${row['Taille'] || ''}\n` +
                `🎯 Matière : ${row['Matière'] || ''}`;
            if (row['Doublure'] && row['Doublure'].trim() !== '') {
                caracteristiques += `\n🧥 Doublure : ${row['Doublure']}`;
            }

            // Générer uniquement la description personnalisée
            const prompt = `Rédige une description attrayante et détaillée pour un article moto d'occasion à vendre sur Vinted, à partir des informations suivantes : ${JSON.stringify(row)}. La description doit faire entre 200 et 250 caractères maximum. Ne parle pas de la boutique, des conseils, ni d'informations générales. Ne mets pas de hashtags. Ne parle de la doublure que si l'information est présente.`;
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

            // Générer le titre de l'annonce
            const titrePrompt = `Génère un titre court et vendeur pour une annonce Vinted à partir des informations suivantes : ${JSON.stringify(row)}. Le titre doit être au format : [Nom de l'article ou Désignation] – Taille [Taille] – [État] – Sunset Rider. N'invente rien, utilise uniquement les informations fournies.`;
            console.log(`Appel OpenAI pour le titre de la ligne ${i} :`, titrePrompt);
            const titreCompletion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: "Tu es un expert en rédaction d'annonces Vinted. Génère uniquement le titre demandé." },
                    { role: 'user', content: titrePrompt }
                ],
                temperature: 0.5
            });
            const titre = titreCompletion.choices[0].message.content.trim();
            console.log(`Titre généré pour la ligne ${i} :`, titre);

            // Ajout des sections fixes
            const annonce = `${titre}\n\nS'équiper et rouler en sécurité ne doit plus être un luxe.\nSunset Rider – 1ère entreprise de seconde main moto reconditionnée en France.\n\n📸 Photos 100% authentiques prises par nos soins. Fond blanc pour une mise en valeur optimale.\n\n🏆 Caractéristiques :\n\n${caracteristiques}\n\n🧥 ${row['Designation'] || row['Nom de l\'article'] || ''}\n${description}\n\n${QUI_SOMMES_NOUS}\n\n${INFOS_SUPP}\n\n${HASHTAGS}${UGS_ET_PROTECTION(row['Code article'] || row['UGS'] || '')}`;
            output += annonce + '\n\n───────────────────────────────\n\n';
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