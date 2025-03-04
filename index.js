import express from "express";
import { dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import env from "dotenv";
import multer from "multer";
import multerS3 from "multer-s3";
import { S3Client } from "@aws-sdk/client-s3";
import bcrypt from "bcrypt";
import passport from "passport";
import { Strategy } from "passport-local";
import session from "express-session";

env.config();
const app = express();
const port = process.env.SERVER_PORT;
const saltRounds = 15;
const __dirname = dirname(fileURLToPath(import.meta.url));

const s3 = new S3Client();

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.BUCKET,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      cb(null, Date.now().toString() + file.originalname);
    },
  }),
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
  })
);

app.use(passport.initialize());
app.use(passport.session());

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

app.get("/availablePuppies", async (req, res) => {
  const availableResult = await db.query("SELECT * FROM puppies");
  const puppies = availableResult.rows;
  const imageURLsResult = await db.query("SELECT * FROM puppyimages");
  const imageURLs = imageURLsResult.rows;
  res.render("availablePuppies.ejs", {
    puppies: puppies,
    imageURLs: imageURLs,
  });
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

app.get("/login", (req, res) => {
  res.render("login.ejs");
});

app.get("/logout", (req, res) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect("/");
  });
});

//NEEDS ADMIN

// app.post("/register", async (req, res) => {
//   const username = req.body.username;
//   const password = req.body.password;
//   try {
//     const checkResult = await db.query("SELECT * FROM users WHERE username = $1", [
//       username,
//     ]);
//     if (checkResult.rows.length > 0) {
//       req.redirect("/login");
//     } else {
//       bcrypt.hash(password, saltRounds, async (err, hash) => {
//         if (err) {
//           console.error("Error hashing password:", err);
//         } else {
//           const result = await db.query(
//             "INSERT INTO users (username, password) VALUES ($1, $2) RETURNING *",
//             [username, hash]
//           );
//           const user = result.rows[0];
//           req.login(user, (err) => {
//             console.log("success");
//             res.redirect("/adminHome");
//           });
//         }
//       });
//     }
//   } catch (err) {
//     console.log(err);
//   }
// });

app.post(
  "/login",
  passport.authenticate("local", {
    successRedirect: "/adminHome",
    failureRedirect: "/login",
  })
);

app.get("/adminHome", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("./admin/adminHome.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/addPuppy", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("./admin/addPuppy.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/addParent", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("./admin/addParent.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/manageParents", (req, res) => {
  if (req.isAuthenticated()) {
    res.render("./admin/manageParents.ejs");
  } else {
    res.redirect("/login");
  }
});

app.get("/managePuppies", async (req, res) => {
  if (req.isAuthenticated()) {
    const availableResult = await db.query("SELECT * FROM puppies");
    const puppies = availableResult.rows;
    const imageURLsResult = await db.query("SELECT * FROM puppyimages");
    const imageURLs = imageURLsResult.rows;
    res.render("./admin/managePuppies.ejs", {
      puppies: puppies,
      imageURLs: imageURLs,
    });
  } else {
    res.redirect("/login");
  }
});

app.post("/updatePuppy", async (req, res) => {
  if (req.isAuthenticated()) {
    const currentDBPuppyRecord = await db.query(
      "SELECT * FROM puppies WHERE id = $1",
      [req.body.id]
    );
    const id = req.body.id;
    const name = req.body.puppyName;
    const breed = req.body.puppyBreed;
    const gender = req.body.genderSelect;
    const dob = req.body.dob;
    const mother = req.body.puppyMother;
    const father = req.body.puppyFather;
    const akcRegistrable = req.body.akcRegistrable;
    const price = req.body.price;
    const soldStatus = req.body.soldStatus;
    await db.query(
      "UPDATE puppies SET name = $2, breed = $3, gender = $4, dob = $5, mother = $6, father = $7, akcregistrable = $8, price = $9, sold = $10 WHERE id=$1",
      [
        id,
        name,
        breed,
        gender,
        dob,
        mother,
        father,
        akcRegistrable,
        price,
        soldStatus,
      ]
    );
    res.redirect("/managePuppies");
  } else {
    res.redirect("/login");
  }
});

app.post("/submitNewPuppy", upload.array("puppyImageUpload"), async (req, res) => {
  if (req.isAuthenticated()) {
    const newPuppy = req.body;
    const akcRegistrable = newPuppy.akcRegistrable === "true" ? true : false;
    const price = newPuppy.price ? newPuppy.price : 0;
    await db.query(
      "INSERT INTO puppies (name, breed, gender, dob, price, mother, father, akcRegistrable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        newPuppy.puppyName,
        newPuppy.puppyBreed,
        newPuppy.genderSelect,
        newPuppy.dob,
        price,
        newPuppy.puppyMother,
        newPuppy.puppyFather,
        akcRegistrable,
      ]
    );
    for (var i = 0; i < req.files.length; i++) {
      await db.query(
        "INSERT INTO puppyimages (imageid, puppyid) SELECT $1, id FROM puppies WHERE name = $2",
        [req.files[i].key, newPuppy.puppyName]
      );
    }
    res.redirect("/availablePuppies");
  }   else {
    res.redirect("/login");
  }
});

passport.use(
  "local",
  new Strategy(async function verify(username, password, cb) {
    try {
      const result = await db.query(
        "SELECT * FROM users WHERE username = $1 ",
        [username]
      );
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const storedHashedPassword = user.password;
        bcrypt.compare(password, storedHashedPassword, (err, valid) => {
          if (err) {
            //Error with password check
            console.error("Error comparing passwords:", err);
            return cb(err);
          } else {
            if (valid) {
              //Passed password check
              console.log("Password Success");
              return cb(null, user);
            } else {
              //Did not pass password check
              console.log("Password Invalid");
              return cb(null, false);
            }
          }
        });
      } else {
        return cb("User not found");
      }
    } catch (err) {
      console.log(err);
    }
  })
);

passport.serializeUser((user, cb) => {
  cb(null, user);
});
passport.deserializeUser((user, cb) => {
  cb(null, user);
});

app.listen(port, (req, res) => {
  console.log(`Listening @ ${port}`);
});
