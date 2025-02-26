import express from "express"
import { dirname } from "path";
import { fileURLToPath } from "url";
import env from "dotenv"

const app = new express();
const port = 3000;
const __dirname = dirname(fileURLToPath(import.meta.url));
env.config();

app.use(express.urlencoded({extended:true}))
app.use(express.static(`${__dirname}/public`));

app.get("/", (req,res) => {
    res.render("index.ejs")
})

app.get("/availablePuppies", (req,res)=>{
    res.render("availablePuppies.ejs")
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