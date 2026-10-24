import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import classosRouter from "./classos";
import { requireUser } from "../lib/auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(requireUser);
router.use(adminRouter);
router.use(classosRouter);

export default router;
