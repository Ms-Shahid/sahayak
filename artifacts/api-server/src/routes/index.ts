import { Router, type IRouter } from "express";
import healthRouter from "./health";
import classosRouter from "./classos";
import accountsRouter from "./accounts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(classosRouter);

export default router;
