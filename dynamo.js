const AWS = require('aws-sdk')
const dynamo = new AWS.DynamoDB.DocumentClient()

exports.getLambdaConfig = async (lambdaName = 'vintedLambda') => {
try {
    const params = { 
        TableName: 'ClientLambdas',
        Key: {
            clientId: "clientA",
            lambdaName: lambdaName
        }
    }

    const result = await dynamo.get(params).promise()
    return result.Item
} catch (error) {
    console.error('Error getting lambda config:', error)
    throw error
    }
}

exports.getQuiSommesNous = async () => {
    const config = await exports.getLambdaConfig()
    return config.config.quiSommesNous
}

exports.getInfosSupp = async () => {
    const config = await exports.getLambdaConfig()
    return config.config.infosSupp
}

exports.getHashtags = async () => {
    const config = await exports.getLambdaConfig()
    return config.config.hashtags
}

exports.getUgsEtProtection = async () => {
    const config = await exports.getLambdaConfig()
    return config.config.ugsEtProtection
}

exports.getPromptTemplate = async () => {
    const config = await exports.getLambdaConfig()
    return config.config.gptPrompt
}