import { QdrantClient } from '@qdrant/js-client-rest'
import neo4j from 'neo4j-driver'
import dotenv from 'dotenv'
import { GoogleGenerativeAI } from '@google/generative-ai'
dotenv.config()

async function main() {
   //? Neo4j connection locally
   const URI = process.env.NEO4J_URI
   const USER = process.env.NEO4J_USERNAME
   const PASSWORD = process.env.NEO4J_PASSWORD
   let driver

   try {
      driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD))
      const serverInfo = await driver.getServerInfo()
      console.log('Connection established')
      console.log(serverInfo)
   } catch (err) {
      console.log(`Connection error\n${err}\nCause: ${err.cause}`)
   }

   //? TO connect to Qdrant running locally
   const client = new QdrantClient({ url: process.env.QDRANT_URL })

   //*Trying Qdrant client connection
   const result = await client.getCollections()
   console.log('List of collections:', result.collections)

   //* closing Neo4j Connection
   //    console.log('Closing connection...')
   //    await driver.close()

   //? Setting up Google Generative AI
}

main()
