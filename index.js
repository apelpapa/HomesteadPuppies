import express from "express";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import env from "dotenv";
import multer from "multer";

env.config();
const app = express();
const port = process.env.SERVER_PORT;
const __dirname = dirname(fileURLToPath(import.meta.url));

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, `${__dirname}/public/data/uploads/`);
  },
  filename: function (req, file, cb) {
    const uniquePrefix = Date.now() + "-" + Math.round(Math.random() * 100);
    cb(null, uniquePrefix + file.originalname);
  },
});

const upload = multer({ storage: storage });

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(`${__dirname}/public`));

const db = new pg.Client({
  ssl: true,
});

db.connect();

app.get("/", (req, res) => {
  res.render("index.ejs");
});

app.get("/adminHome", (req, res) => {
  res.render("./admin/adminHome.ejs");
});

app.get("/addPuppy", (req, res) => {
  res.render("./admin/addPuppy.ejs");
});

app.get("/addParent", (req, res) => {
  res.render("./admin/addParent.ejs");
});

app.get("/manageParents", (req, res) => {
  res.render("./admin/manageParents.ejs");
});

app.get("/managePuppies", (req, res) => {
  res.render("./admin/managePuppies.ejs");
});

app.get("/availablePuppies", async (req, res) => {
  const availableResult = await db.query("SELECT * FROM puppies");
  const puppies = availableResult.rows;
  const imageResult = await db.query("SELECT * FROM puppyimages");
  const images = imageResult.rows;
  res.render("availablePuppies.ejs", { puppies: puppies });
});

app.get("/parents", (req, res) => {
  res.render("parents.ejs");
});
app.get("/deposit", (req, res) => {
  res.render("deposit.ejs");
});
app.get("/contact", (req, res) => {
  res.render("contact.ejs");
});

app.post(
  "/submitNewPuppy",
  upload.array("puppyImageUpload"),
  async (req, res) => {
    const newPuppy = req.body;
    const akcRegistrable = newPuppy.akcRegistrable === "true" ? true : false;
    await db.query(
      "INSERT INTO puppies (name, breed, gender, dob, price, mother, father, akcRegistrable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        newPuppy.puppyName,
        newPuppy.puppyBreed,
        newPuppy.genderSelect,
        newPuppy.dob,
        newPuppy.price,
        newPuppy.puppyMother,
        newPuppy.puppyFather,
        akcRegistrable,
      ]);
      for(var i=0; i<req.files.length; i++){
      await db.query(
        "INSERT INTO puppyimages (imageid, puppyid) SELECT $1, id FROM puppies WHERE name = $2", [req.files[i].filename, newPuppy.puppyName]
      )
    }
    res.send("Upload Great Success");
  }
);

app.listen(port, (req, res) => {
  console.log(`Listening @ ${port}`);
});
