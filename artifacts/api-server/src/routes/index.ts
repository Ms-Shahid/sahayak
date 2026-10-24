import { Router, type IRouter } from "express";
import healthRouter from "./health";
import classosRouter from "./classos";

const router: IRouter = Router();

router.use(healthRouter);
router.use(classosRouter);

export default router;
