import express from "express"
import { dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg"
import env from "dotenv"

env.config();
const app = new express();
const port = process.env.SERVER_PORT;
const __dirname = dirname(fileURLToPath(import.meta.url));

app.use(express.urlencoded({extended:true}))
app.use(express.static(`${__dirname}/public`));

const db = new pg.Client({
    user: process.env.PG_USER,
    host: process.env.PG_HOST,
    database: process.env.PG_DATABASE,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT
});

db.connect()

app.get("/", (req,res) => {
    res.render("index.ejs")
})

app.get("/availablePuppies", async (req,res)=>{
    const result = await db.query("SELECT * FROM puppies");
    const puppies = result.rows;
    res.render("availablePuppies.ejs", {puppies: puppies})
})

app.get("/parents", (req,res)=>{
    res.render("parents.ejs")
})
app.get("/deposit", (req,res)=>{
    res.render("deposit.ejs")
})
app.get("/contact", (req,res)=>{
    res.render("contact.ejs")
})

app.listen(port,(req,res) =>{
    console.log(`Listening @ ${port}`)
})