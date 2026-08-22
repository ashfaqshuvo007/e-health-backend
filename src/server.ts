import app from "./app";
import config from "./app/config";
import { transporter } from "./app/lib/nodemailer";
import { prisma } from "./app/lib/prisma";
import { redisClient } from "./app/lib/redis";
import {
  seedAdmin,
  seedSuperAdmin,
  seedTestDoctor,
  seedTestPatient,
} from "./app/utils/dbSeed";

const PORT = config.port;

const main = async () => {
  try {
    await prisma.$connect();
    console.log("Connected To DB Successfully.");

    await redisClient.connect();
    console.log("Connected To Redis Successfully.");

    await seedSuperAdmin();
    await seedAdmin();
    await seedTestDoctor();
    await seedTestPatient();
    console.log("DB Seeded With Test Data Successfully.");

    await transporter.verify();
    console.log("Nodemailer Connected Successfully.");

    app.listen(PORT, () => {
      console.log(`Server Is Running On Port ${PORT}`);
    });
  } catch (error) {
    console.error("Error Starting The Server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

main();
