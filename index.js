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


app.listen(port,(req,res) =>{
    console.log(`Listening @ ${port}`)
})