const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { parse } = require('csv-parse/sync');
const { OpenAI } = require('openai');
const { getQuiSommesNous, getInfosSupp, getHashtags, getUgsEtProtection, getPromptTemplate } = require('./dynamo');

const s3 = new S3Client();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const UGS_ET_PROTECTION = (ugs) => `\n🔗 UGS : ${ugs}`;

// Fonction utilitaire pour déduire le genre à partir de la colonne Famille
function getGenre(famille) {
    if (!famille) return '';
    const f = famille.toLowerCase();
    if (f.includes('femme')) return 'Femme';
    if (f.includes('homme')) return 'Homme';
    if (f.includes('enfant')) return 'Enfant';
    return 'Unisexe';
}

// Fonction utilitaire pour déterminer le type d'article
function getTypeArticle(famille, matiere) {
    if (!famille) return '';
    const f = famille.toLowerCase();
    if (f.includes('pantalon')) return 'Pantalon';
    if (f.includes('blouson et veste')) {
        if (matiere && matiere.toLowerCase().includes('cuir')) return 'Blouson';
        if (matiere && matiere.toLowerCase().includes('textile')) return 'Veste';
        return '';
    }
    return famille;
}

exports.handler = async (event) => {
    console.log('Début de la lambda. Event reçu :', JSON.stringify(event, null, 2));
    try {
        // Récupération des configurations depuis DynamoDB
        const QUI_SOMMES_NOUS = await getQuiSommesNous();
        const INFOS_SUPP = await getInfosSupp();
        const HASHTAGS = await getHashtags();
        const PROMPT_TEMPLATE = await getPromptTemplate();
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
            // Construction de la section Caractéristiques avec la règle sur l'état
            const genre = getGenre(row['Famille']);
            let etat = row['État'] || row['Etat'] || '';
            let suffixe = ' - nettoyé, désinfecté';
            if (
              row['Famille'] &&
              (
                row['Famille'].toLowerCase().includes('blouson et veste') ||
                row['Famille'].toLowerCase().includes('chaussures')
              )
            ) {
              suffixe += ' & imperméabilisé';
            }
            etat += suffixe;

            let caracteristiques =  `✅ Taille : ${row['Taille'] || ''} ${genre ? genre : ''} - Mesures en photo\n` +
                `✨ État : ${etat}\n` +
                `🛡️ Protections : ${row['Protections'] || ''}\n` +
                `🎯 Matière : ${row['Matière'] || ''}`;
            if (row['Doublure'] && row['Doublure'].trim() !== '') {
                caracteristiques += ` 🧥 Doublure : ${row['Doublure']}`;
            }
            caracteristiques += '\n📸 Photos 100% authentiques sur fond blanc';

            // Générer uniquement la description personnalisée avec template dynamique
            const prompt = PROMPT_TEMPLATE
                .replace('{PRODUCT_DATA}', JSON.stringify(row))
                .replace('{SPECIFIC_ASSETS}', JSON.stringify(row['Indications pour description']));
            console.log(`Appel OpenAI pour la ligne ${i} :`, prompt);
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o',
                messages: [
                    { role: 'system', content: 'Tu es un expert en marketing et en vente en ligne. Tu es capable de générer des descriptions attrayantes pour des articles de vente en ligne à destination de Vinted.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 1
            });
            const description = completion.choices[0].message.content;
            console.log(`Réponse OpenAI pour la ligne ${i} :`, description);

            // Construction du titre selon les règles métier
            const typeArticle = getTypeArticle(row['Famille'], row['Matière']);
            const designation = row['Designation'] || '';
            const tailleGenre = `${row['Taille'] || ''} ${genre}`.trim();
            const etatTitre = row['État'] || row['Etat'] || '';
            const titre = `${typeArticle} ${designation} – ${tailleGenre} – ${etatTitre} – Sunset Rider`.replace(/\s+/g, ' ').replace('  ', ' ').trim();

            // Ajout des sections fixes
            const annonce = `${titre}\n\n🥇100% Satisfait ou Remboursé!\nSunset Rider – 1ère entreprise en ligne de seconde main moto reconditionnée.\n\n${caracteristiques}\n\n📢 Les équipements moto ont tendance à tailler petit, n'hésitez pas à prendre une taille au-dessus.\n\nS'équiper et rouler en sécurité ne doit plus être un luxe.\n\n🧥 ${row['Designation'] || row['Nom de l\'article'] || ''}\n${description}\n\n${QUI_SOMMES_NOUS}\n\n${INFOS_SUPP}\n\n📌 Texte protégé – Toute reproduction interdite.\n\n${HASHTAGS}${UGS_ET_PROTECTION(row['Code article'] || row['UGS'] || '')}`;
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